const crypto = require('crypto');
const CanvaConfig = require('../models/CanvaConfig');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Exchange / Refresh token in Canva API
async function makeTokenRequest(clientId, clientSecret, bodyParams) {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams(bodyParams).toString();

  const response = await fetch('https://api.canva.com/rest/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.message || `Token request failed: ${response.status}`);
  }
  return data;
}

// Helper: Get a valid access token (refresh if expired)
async function getValidAccessToken(userId) {
  const config = await CanvaConfig.findOne({ userId });
  if (!config || !config.accessToken) {
    throw new Error('Canva integration not connected');
  }

  // Check if token is expired or close to expiring (1 min threshold)
  const isExpired = !config.tokenExpiresAt || (new Date(config.tokenExpiresAt).getTime() - Date.now() < 60 * 1000);
  if (isExpired) {
    if (!config.refreshToken) {
      throw new Error('Canva connection lost. Please reconnect.');
    }

    try {
      const data = await makeTokenRequest(config.clientId, config.clientSecret, {
        grant_type: 'refresh_token',
        refresh_token: config.refreshToken
      });

      config.accessToken = data.access_token;
      config.refreshToken = data.refresh_token;
      config.tokenExpiresAt = new Date(Date.now() + data.expires_in * 1000);
      config.scopes = data.scope.split(' ');
      await config.save();
    } catch (error) {
      console.error('Failed to refresh Canva token:', error);
      throw new Error(`Canva authentication expired: ${error.message}`);
    }
  }

  return config.accessToken;
}

// Helper: Poll status of an asynchronous job
async function pollJob(url, accessToken, options = {}) {
  const maxTime = options.maxTime || 45000; // 45 seconds max
  const startTime = Date.now();
  let delay = options.initialDelay || 1000; // start at 1s
  const maxDelay = options.maxDelay || 4000; // max 4s

  while (Date.now() - startTime < maxTime) {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody.message || `Canva job query failed: ${response.status}`);
    }

    const data = await response.json();
    const job = data.job;

    if (!job) {
      throw new Error('API response did not return a valid job status');
    }

    if (job.status === 'success') {
      return job;
    } else if (job.status === 'failed') {
      const errorMsg = job.error?.message || 'Job execution failed in Canva';
      throw new Error(errorMsg);
    }

    await sleep(delay);
    delay = Math.min(delay * 1.5, maxDelay);
  }

  throw new Error('Canva operation timed out. Please try again.');
}

// 1. Get Client Config (Sanitized)
exports.getConfig = async (req, res) => {
  try {
    const config = await CanvaConfig.findOne({ userId: req.user.userId });
    res.json({
      success: true,
      config: config ? {
        clientId: config.clientId,
        redirectUri: config.redirectUri,
        hasClientSecret: !!config.clientSecret,
        isConnected: !!config.accessToken
      } : {
        clientId: '',
        redirectUri: 'http://localhost:5173/dashboard/ai-assistant',
        hasClientSecret: false,
        isConnected: false
      }
    });
  } catch (error) {
    console.error('getConfig error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. Save Client Config
exports.saveConfig = async (req, res) => {
  try {
    const { clientId, clientSecret, redirectUri } = req.body;
    let config = await CanvaConfig.findOne({ userId: req.user.userId });

    if (!config) {
      config = new CanvaConfig({ userId: req.user.userId });
    }

    if (clientId !== undefined) config.clientId = clientId;
    if (clientSecret !== undefined) config.clientSecret = clientSecret;
    if (redirectUri !== undefined) config.redirectUri = redirectUri;

    await config.save();

    res.json({
      success: true,
      message: 'Canva developer configuration saved successfully',
      config: {
        clientId: config.clientId,
        redirectUri: config.redirectUri,
        hasClientSecret: !!config.clientSecret,
        isConnected: !!config.accessToken
      }
    });
  } catch (error) {
    console.error('saveConfig error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. Initiate OAuth 2.0 PKCE Flow
exports.getAuthUrl = async (req, res) => {
  try {
    const config = await CanvaConfig.findOne({ userId: req.user.userId });
    if (!config || !config.clientId || !config.clientSecret) {
      return res.status(400).json({
        success: false,
        message: 'Please configure Canva Client ID and Client Secret first'
      });
    }

    // Generate state and code verifier
    const state = crypto.randomBytes(32).toString('base64url');
    const codeVerifier = crypto.randomBytes(96).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    config.state = state;
    config.codeVerifier = codeVerifier;
    await config.save();

    const scopes = [
      'design:content:read',
      'design:content:write',
      'design:meta:read',
      'brandtemplate:meta:read',
      'brandtemplate:content:read',
      'asset:read',
      'asset:write',
      'folder:read',
      'folder:write',
      'profile:read'
    ].join(' ');

    const authUrl = `https://www.canva.com/api/oauth/authorize?` + new URLSearchParams({
      code_challenge: codeChallenge,
      code_challenge_method: 's256',
      scope: scopes,
      response_type: 'code',
      client_id: config.clientId,
      state,
      redirect_uri: config.redirectUri
    }).toString();

    res.json({ success: true, authUrl });
  } catch (error) {
    console.error('getAuthUrl error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. Handle OAuth Callback / Exchange Token
exports.handleCallback = async (req, res) => {
  try {
    const { code, state } = req.body;
    if (!code || !state) {
      return res.status(400).json({ success: false, message: 'Missing code or state parameters' });
    }

    const config = await CanvaConfig.findOne({ userId: req.user.userId });
    if (!config) {
      return res.status(404).json({ success: false, message: 'Canva developer settings not found' });
    }

    // CSRF verification
    if (config.state !== state) {
      return res.status(400).json({ success: false, message: 'OAuth CSRF verification failed: state mismatch' });
    }

    const tokenData = await makeTokenRequest(config.clientId, config.clientSecret, {
      grant_type: 'authorization_code',
      code_verifier: config.codeVerifier,
      code,
      redirect_uri: config.redirectUri
    });

    config.accessToken = tokenData.access_token;
    config.refreshToken = tokenData.refresh_token;
    config.tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
    config.scopes = tokenData.scope.split(' ');
    config.state = '';
    config.codeVerifier = '';
    await config.save();

    res.json({
      success: true,
      message: 'Canva connected successfully'
    });
  } catch (error) {
    console.error('handleCallback error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 5. Get User Profile
exports.getProfile = async (req, res) => {
  try {
    const token = await getValidAccessToken(req.user.userId);
    const response = await fetch('https://api.canva.com/rest/v1/users/me/profile', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Profile request failed with status: ${response.status}`);
    }

    const data = await response.json();
    res.json({ success: true, profile: data.profile });
  } catch (error) {
    console.error('getProfile error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 6. Disconnect
exports.disconnect = async (req, res) => {
  try {
    const config = await CanvaConfig.findOne({ userId: req.user.userId });
    if (config) {
      // Try revoking the token if possible
      if (config.accessToken) {
        try {
          const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
          await fetch('https://api.canva.com/rest/v1/oauth/revoke', {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${credentials}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({ token: config.accessToken }).toString()
          });
        } catch (e) {
          console.warn('Revoking token failed on disconnect:', e);
        }
      }

      config.accessToken = '';
      config.refreshToken = '';
      config.tokenExpiresAt = null;
      config.scopes = [];
      await config.save();
    }

    res.json({ success: true, message: 'Disconnected from Canva successfully' });
  } catch (error) {
    console.error('disconnect error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 7. List Brand Templates
exports.listBrandTemplates = async (req, res) => {
  try {
    const token = await getValidAccessToken(req.user.userId);
    const response = await fetch('https://api.canva.com/rest/v1/brand-templates', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || `Canva failed to list brand templates: ${response.status}`);
    }

    res.json({ success: true, brandTemplates: data.brand_templates || [] });
  } catch (error) {
    console.error('listBrandTemplates error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 8. Get Brand Template Dataset (Autofill fields)
exports.getTemplateDataset = async (req, res) => {
  try {
    const { id } = req.params;
    const token = await getValidAccessToken(req.user.userId);
    const response = await fetch(`https://api.canva.com/rest/v1/brand-templates/${id}/dataset`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || `Canva failed to fetch template dataset: ${response.status}`);
    }

    res.json({ success: true, dataset: data.dataset || {} });
  } catch (error) {
    console.error('getTemplateDataset error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 9. Autofill Template and Export PNG (Complete Orchestrated Flow)
exports.autofillAndExport = async (req, res) => {
  try {
    const { brand_template_id, data: autofillData, title } = req.body;
    if (!brand_template_id || !autofillData) {
      return res.status(400).json({ success: false, message: 'Missing brand_template_id or data' });
    }

    const token = await getValidAccessToken(req.user.userId);

    // Step 1: Create Autofill Job
    console.log(`Starting Autofill Job for template: ${brand_template_id}`);
    const autofillInitResponse = await fetch('https://api.canva.com/rest/v1/autofills', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        brand_template_id,
        data: autofillData,
        title: title || 'Autofilled Campaign Design'
      })
    });

    const autofillInitData = await autofillInitResponse.json();
    if (!autofillInitResponse.ok) {
      throw new Error(autofillInitData.message || `Autofill initialization failed: ${autofillInitResponse.status}`);
    }

    const autofillJobId = autofillInitData.job?.id;
    if (!autofillJobId) {
      throw new Error('Canva Connect API failed to return an autofill Job ID');
    }

    // Step 2: Poll Autofill Job
    console.log(`Polling Autofill Job: ${autofillJobId}`);
    const completedAutofillJob = await pollJob(
      `https://api.canva.com/rest/v1/autofills/${autofillJobId}`,
      token,
      { maxTime: 45000 }
    );

    const newDesignId = completedAutofillJob.result?.design?.id;
    const designTitle = completedAutofillJob.result?.design?.title;
    const urls = completedAutofillJob.result?.design?.urls;

    if (!newDesignId) {
      throw new Error('Autofill job succeeded but did not return a design ID');
    }

    // Step 3: Create Export Job to PNG
    console.log(`Starting Export Job for design: ${newDesignId}`);
    const exportInitResponse = await fetch('https://api.canva.com/rest/v1/exports', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        design_id: newDesignId,
        format: {
          type: 'png',
          export_quality: 'regular'
        }
      })
    });

    const exportInitData = await exportInitResponse.json();
    if (!exportInitResponse.ok) {
      throw new Error(exportInitData.message || `Export initialization failed: ${exportInitResponse.status}`);
    }

    const exportJobId = exportInitData.job?.id;
    if (!exportJobId) {
      throw new Error('Canva Connect API failed to return an export Job ID');
    }

    // Step 4: Poll Export Job
    console.log(`Polling Export Job: ${exportJobId}`);
    const completedExportJob = await pollJob(
      `https://api.canva.com/rest/v1/exports/${exportJobId}`,
      token,
      { maxTime: 45000 }
    );

    const exportUrls = completedExportJob.urls;
    if (!exportUrls || exportUrls.length === 0) {
      throw new Error('Export job succeeded but did not return download URLs');
    }

    // Return design info and the final compiled image URL
    res.json({
      success: true,
      design: {
        id: newDesignId,
        title: designTitle || 'Autofilled Design',
        editUrl: urls?.edit_url,
        viewUrl: urls?.view_url,
        imageUrl: exportUrls[0], // Direct PNG download URL
        createdAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('autofillAndExport error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 10. List User's Personal Designs
exports.listDesigns = async (req, res) => {
  try {
    const token = await getValidAccessToken(req.user.userId);
    const response = await fetch('https://api.canva.com/rest/v1/designs', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || `Canva failed to list designs: ${response.status}`);
    }

    res.json({ success: true, designs: data.items || [] });
  } catch (error) {
    console.error('listDesigns error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 11. Export existing design to PNG
exports.exportDesign = async (req, res) => {
  try {
    const { design_id } = req.body;
    if (!design_id) {
      return res.status(400).json({ success: false, message: 'Missing design_id' });
    }

    const token = await getValidAccessToken(req.user.userId);

    console.log(`Starting Export Job for design: ${design_id}`);
    const exportInitResponse = await fetch('https://api.canva.com/rest/v1/exports', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        design_id,
        format: {
          type: 'png',
          export_quality: 'regular'
        }
      })
    });

    const exportInitData = await exportInitResponse.json();
    if (!exportInitResponse.ok) {
      throw new Error(exportInitData.message || `Export initialization failed: ${exportInitResponse.status}`);
    }

    const exportJobId = exportInitData.job?.id;
    if (!exportJobId) {
      throw new Error('Canva Connect API failed to return an export Job ID');
    }

    console.log(`Polling Export Job: ${exportJobId}`);
    const completedExportJob = await pollJob(
      `https://api.canva.com/rest/v1/exports/${exportJobId}`,
      token,
      { maxTime: 45000 }
    );

    const exportUrls = completedExportJob.urls;
    if (!exportUrls || exportUrls.length === 0) {
      throw new Error('Export job succeeded but did not return download URLs');
    }

    res.json({
      success: true,
      imageUrl: exportUrls[0]
    });
  } catch (error) {
    console.error('exportDesign error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
