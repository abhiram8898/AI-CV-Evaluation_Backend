const express = require("express");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const cors = require("cors");

// Load environment variables from .env file
require("dotenv").config();

const app = express();
const PORT = process.env.PORT;

// Add CORS middleware - Place this at the top
app.use(
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:3000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// Handle preflight requests
app.options("*", cors());

// Add other middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for memory storage (no disk saving)
const upload = multer({
  storage: multer.memoryStorage(), // Store file in memory as buffer
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

/**
 * Fetches Salesforce access token using OAuth 2.0 Client Credentials flow
 */
async function fetchSalesforceAccessToken() {
  const loginUrl = process.env.SF_LOGIN_URL;
  console.log("Using Salesforce login URL:", loginUrl);

  const baseUrl = loginUrl.endsWith("/") ? loginUrl.slice(0, -1) : loginUrl;
  const tokenEndpoint = `${baseUrl}/services/oauth2/token`;

  try {
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SF_CLIENT_ID,
      client_secret: process.env.SF_CLIENT_SECRET,
    });

    const response = await axios.post(tokenEndpoint, params.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    console.log("✅ Salesforce access token retrieved successfully");
    return response.data;
  } catch (error) {
    console.error("❌ Salesforce OAuth error:", error.message);
    if (error.response) {
      console.error("OAuth response error:", error.response.data);
    }
    throw error;
  }
}

/**
 * Simulates saving to Salesforce - just logs everything
 */
async function simulateSalesforceSave(analysisData) {
  try {
    console.log("🔌 Connecting to Salesforce...");

    // Get access token
    const authResult = await fetchSalesforceAccessToken();

    console.log(
      "✅ Connected to Salesforce instance:",
      authResult.instance_url
    );

    // Prepare the data for Salesforce (just for logging)
    const salesforceRecord = {
      Name: `CV Analysis - ${analysisData.fileId}`,
      Analysis_Data__c: JSON.stringify(analysisData.analysed),
      Edited_Data__c: JSON.stringify(analysisData.edited),
      File_Name__c: analysisData.fileId,
      Analysis_Date__c: new Date().toISOString(),
      Status__c: "Completed",
    };

    console.log("💾 WOULD SAVE TO SALESFORCE:");
    console.log("==========================================");
    console.log("Salesforce Object: Account");
    console.log("Record Data:", JSON.stringify(salesforceRecord, null, 2));
    console.log("==========================================");

    console.log("📊 Analysis Data Summary:");
    if (analysisData.analysed) {
      Object.keys(analysisData.analysed).forEach((category) => {
        const items = analysisData.analysed[category];
        console.log(`   - ${category}: ${items?.length || 0} items`);
        if (items && items.length > 0) {
          items.forEach((item, index) => {
            console.log(
              `     ${index + 1}. ${item.hard_criterium} (Score: ${
                item.score || "N/A"
              })`
            );
          });
        }
      });
    }

    console.log("📝 Edited Data Summary:");
    if (analysisData.edited) {
      Object.keys(analysisData.edited).forEach((step) => {
        const items = analysisData.edited[step];
        console.log(`   - Step ${step}: ${items?.length || 0} edited items`);
        if (items && items.length > 0) {
          items.forEach((item, index) => {
            console.log(
              `     ${index + 1}. ${item.label} (Negative: ${item.isNegative})`
            );
            if (item.feedback) {
              console.log(`       Feedback: ${item.feedback}`);
            }
          });
        }
      });
    }

    // Simulate successful save without actually creating
    console.log(
      "✅ SIMULATED: Data would be saved to Salesforce successfully!"
    );

    return {
      success: true,
      salesforceId: "SIMULATED-RECORD-ID-12345",
      message: "Analysis data prepared for Salesforce (simulated save)",
    };
  } catch (error) {
    console.error("❌ Salesforce connection failed:", error.message);
    throw error;
  }
}

// Upload endpoint - Stream file directly to n8n without saving
app.post("/api/upload", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "File missing" });
    }

    console.log("File received in memory:", {
      originalname: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });

    const formData = new FormData();

    // Append the file buffer directly to form data - EXACTLY like the working example
    formData.append("resume", req.file.buffer, req.file.originalname);

    console.log("Forwarding to N8N with exact format:", {
      field: "resume",
      filename: req.file.originalname,
      size: req.file.size,
    });

    const n8nUrl =
      "https://opticat.app.n8n.cloud/webhook/04d3ce21-08a5-4ac9-90a9-4fe11789804d";

    // Use the exact same format as the working example
    const response = await axios.post(n8nUrl, formData, {
      headers: {
        ...formData.getHeaders(),
      },
      timeout: 300000,
    });

    console.log("N8N response received successfully");

    // Send ONLY the n8n response data, nothing else
    res.json(response.data);
  } catch (error) {
    console.error("Forward error:", error.message);

    if (error.code === "ECONNABORTED") {
      console.error("Request timeout - took longer than 5 minutes");
      res.status(504).json({
        error: "Request timeout - server took too long to respond",
      });
    } else if (error.response) {
      console.error(
        "N8N Response error:",
        error.response.status,
        error.response.data
      );
      res.status(502).json({
        error: `N8N Error: ${error.response.status}`,
        details: error.response.data,
      });
    } else if (error.request) {
      res.status(503).json({
        error: "Cannot reach N8N service",
      });
    } else {
      res.status(500).json({
        error: error.message,
      });
    }
  }
});

// Save analysis endpoint - CONNECTS TO SALESFORCE BUT ONLY LOGS
app.post("/api/save-analysis", async (req, res) => {
  try {
    const { analysed, edited, fileId, recordId, savedAt } = req.body;

    console.log("💾 Received analysis data to save to Salesforce:", {
      fileId,
      recordId,
      analysedKeys: Object.keys(analysed || {}),
      editedSteps: Object.keys(edited || {}),
      savedAt,
    });

    // Prepare the complete analysis data
    const analysisData = {
      analysed,
      edited,
      fileId,
      recordId,
      savedAt: savedAt || new Date().toISOString(),
    };

    // Simulate Salesforce save (just logs everything)
    const saveResult = await simulateSalesforceSave(analysisData);

    // Send only success response
    res.json({
      success: true,
      salesforceId: saveResult.salesforceId,
      savedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error during Salesforce simulation:", error.message);

    res.status(500).json({
      success: false,
      error: `Failed to prepare data for Salesforce: ${error.message}`,
    });
  }
});

// Test Salesforce connection endpoint
app.get("/api/test-salesforce", async (req, res) => {
  try {
    console.log("🔌 Testing Salesforce connection...");

    // Test the connection by getting an access token
    const authResult = await fetchSalesforceAccessToken();

    console.log("✅ Salesforce connection successful!");
    console.log("Instance URL:", authResult.instance_url);
    console.log("Access Token: [HIDDEN FOR SECURITY]");

    res.json({
      success: true,
      message: "Salesforce connection successful - ready to log data",
      connected: true,
      instanceUrl: authResult.instance_url,
      canSave: false, // Indicates we're only logging, not saving
      mode: "logging",
    });
  } catch (error) {
    console.error("❌ Salesforce connection test failed:", error.message);

    res.json({
      success: false,
      message: `Salesforce connection failed: ${error.message}`,
      connected: false,
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", message: "Server is running" });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Upload server is running (Salesforce logging mode)",
    endpoints: {
      upload: "POST /api/upload",
      saveAnalysis: "POST /api/save-analysis",
      testSalesforce: "GET /api/test-salesforce",
    },
  });
});

// Start server
app
  .listen(PORT, () => {
    console.log(`🚀 Backend running on http://localhost:${PORT}`);
    console.log(`📊 Available endpoints:`);
    console.log(
      `   - POST /api/upload (File upload to n8n - streams directly, no server storage)`
    );
    console.log(
      `   - POST /api/save-analysis (Log analysis to Salesforce - SIMULATION)`
    );
    console.log(`   - GET /api/test-salesforce (Test Salesforce connection)`);
    console.log(`   - GET /health (Health check)`);
  })
  .on("error", (err) => {
    console.error("Server error:", err);
    process.exit(1);
  });

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});
