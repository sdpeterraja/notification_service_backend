// controllers/aiController.js
const Template = require('../models/Template');

const MOCK_IMAGES = {
  shoes: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&auto=format&fit=crop&q=80",
  electronics: "https://images.unsplash.com/photo-1498049794561-7780e7231661?w=600&auto=format&fit=crop&q=80",
  fashion: "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=600&auto=format&fit=crop&q=80",
  food: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&auto=format&fit=crop&q=80",
  fitness: "https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=600&auto=format&fit=crop&q=80",
  beauty: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600&auto=format&fit=crop&q=80",
  default: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&auto=format&fit=crop&q=80"
};

const MOCK_GRADIENTS = [
  "linear-gradient(135deg, #4f46e5 0%, #ec4899 100%)", // Indigo Pink
  "linear-gradient(135deg, #f97316 0%, #e11d48 100%)", // Orange Red
  "linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)", // Cyan Blue
  "linear-gradient(135deg, #10b981 0%, #059669 100%)", // Emerald Green
  "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)"  // Dark Slate
];

const aiController = {
  async generateTemplate(req, res) {
    try {
      const { prompt, model = 'standard', type = 'email' } = req.body;
      
      if (!prompt) {
        return res.status(400).json({
          success: false,
          message: "Prompt is required"
        });
      }

      console.log(`🤖 AI Generation requested with model: ${model}, prompt: "${prompt}"`);

      // Determine category image by scanning prompt keywords
      const promptLower = prompt.toLowerCase();
      let selectedImage = MOCK_IMAGES.default;
      let category = "General Marketing";

      if (promptLower.includes("shoe") || promptLower.includes("sneaker") || promptLower.includes("footwear")) {
        selectedImage = MOCK_IMAGES.shoes;
        category = "E-commerce Shoes";
      } else if (promptLower.includes("phone") || promptLower.includes("laptop") || promptLower.includes("tech") || promptLower.includes("electronic") || promptLower.includes("computer")) {
        selectedImage = MOCK_IMAGES.electronics;
        category = "Electronics Promotion";
      } else if (promptLower.includes("cloth") || promptLower.includes("wear") || promptLower.includes("fashion") || promptLower.includes("style") || promptLower.includes("shirt")) {
        selectedImage = MOCK_IMAGES.fashion;
        category = "Fashion & Apparel";
      } else if (promptLower.includes("food") || promptLower.includes("eat") || promptLower.includes("restaurant") || promptLower.includes("recipe") || promptLower.includes("meal")) {
        selectedImage = MOCK_IMAGES.food;
        category = "Food & Beverage";
      } else if (promptLower.includes("fit") || promptLower.includes("gym") || promptLower.includes("train") || promptLower.includes("sport") || promptLower.includes("health")) {
        selectedImage = MOCK_IMAGES.fitness;
        category = "Health & Fitness";
      } else if (promptLower.includes("makeup") || promptLower.includes("skincare") || promptLower.includes("beauty") || promptLower.includes("cosmetic")) {
        selectedImage = MOCK_IMAGES.beauty;
        category = "Beauty & Cosmetics";
      }

      // Generate text components dynamically
      let title = "Exclusive Collection Launch";
      let discountText = "Special Discount Applied";
      let ctaText = "Shop Now";
      let subject = "Don't miss our latest collection update!";

      if (promptLower.includes("sale") || promptLower.includes("discount") || promptLower.includes("off")) {
        title = "Flash Sale Alert!";
        discountText = "GET 20% OFF ALL ITEMS";
        ctaText = "Claim Discount";
        subject = "Flash Sale: Grab 20% off before it expires!";
      } else if (promptLower.includes("new") || promptLower.includes("launch") || promptLower.includes("arrive")) {
        title = "Just Arrived!";
        discountText = "Explore Premium Items";
        ctaText = "Explore Collection";
        subject = "New Arrivals: Fresh items just landed in our catalog!";
      } else if (promptLower.includes("winter") || promptLower.includes("cold") || promptLower.includes("snow")) {
        title = "Winter Warmup Deals";
        discountText = "UP TO 50% OFF WINTER COLLECTION";
        ctaText = "Warm Up Deals";
        subject = "Winter Warmup: Free shipping on winter catalog deals!";
      } else if (promptLower.includes("summer") || promptLower.includes("beach") || promptLower.includes("hot")) {
        title = "Summer Vibe Collection";
        discountText = "BEACH READY: 15% OFF ORDERS";
        ctaText = "See Summer Deals";
        subject = "Summer Vibes: Sunny discounts are waiting for you!";
      }

      // Pick a random gradient
      const randomGradient = MOCK_GRADIENTS[Math.floor(Math.random() * MOCK_GRADIENTS.length)];

      // Construct a highly customizable responsive HTML template
      const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Outfit', 'Inter', sans-serif; margin: 0; padding: 0; background-color: #f8fafc; }
    .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
    .hero-banner { background: ${randomGradient}; padding: 60px 40px; text-align: center; color: #ffffff; }
    .hero-banner h1 { margin: 0 0 10px 0; font-size: 36px; font-weight: 900; letter-spacing: -1px; }
    .hero-banner p { margin: 0; font-size: 16px; opacity: 0.9; font-weight: 500; }
    .body-content { padding: 40px; text-align: center; }
    .product-img { width: 100%; max-height: 280px; object-fit: cover; border-radius: 12px; margin-bottom: 30px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
    .promo-badge { display: inline-block; background: #fef3c7; color: #d97706; padding: 8px 16px; border-radius: 9999px; font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 20px; letter-spacing: 1px; }
    .description { color: #475569; font-size: 15px; line-height: 1.6; margin-bottom: 30px; font-weight: 400; }
    .cta-btn { display: inline-block; background: #000000; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 12px; font-weight: 700; font-size: 15px; transition: all 0.2s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .footer { background: #f8fafc; padding: 30px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; }
    .footer a { color: #64748b; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div class="hero-banner">
      <h1>${title}</h1>
      <p>Generated by CatalogStack Design AI</p>
    </div>
    <div class="body-content">
      <span class="promo-badge">${discountText}</span>
      <img src="${selectedImage}" alt="AI generated promo visual" class="product-img" />
      <p class="description">Thank you for being a valued subscriber. We curated this catalog items update based on your profile highlights. Use the unique voucher code at checkout to unlock your savings.</p>
      <a href="https://example.com/shop" class="cta-btn">${ctaText}</a>
    </div>
    <div class="footer">
      <p>You are receiving this because you subscribed to updates from our catalog.</p>
      <p><a href="{{unsubscribe}}">Unsubscribe</a> from this list.</p>
    </div>
  </div>
</body>
</html>`;

      // Return generated asset packages
      res.json({
        success: true,
        data: {
          subject,
          name: `ai_generated_${Date.now()}`,
          category,
          htmlContent,
          visuals: {
            title,
            discountText,
            ctaText,
            imageUrl: selectedImage,
            gradient: randomGradient
          }
        }
      });
      
    } catch (error) {
      console.error("AI template generation failure:", error);
      res.status(500).json({
        success: false,
        message: "Failed to generate design template: " + error.message
      });
    }
  }
};

module.exports = aiController;
