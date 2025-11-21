const express = require("express");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

// Add middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ dest: "uploads/" });

// Ensure uploads directory exists
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

app.post("/api/upload", upload.single("resume"), async (req, res) => {
  let filePath = req.file?.path;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "File missing" });
    }

    console.log("File received:", req.file.filename);
    console.log("Original name:", req.file.originalname);
    console.log("File path:", filePath);

    // Create FormData for N8N
    const formData = new FormData();
    formData.append(
      "resume",
      fs.createReadStream(filePath),
      req.file.originalname
    );

    console.log("Forwarding to N8N...", formData);

    // CORRECTED URL
    const n8nUrl =
      "https://opticat.app.n8n.cloud/webhook-test/04d3ce21-08a5-4ac9-90a9-4fe11789804d";

    const response = await axios.post(n8nUrl, formData, {
      headers: {
        ...formData.getHeaders(),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 30000,
    });

    console.log("N8N response received");

    // Clean up uploaded file
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({
      success: true,
      data: response.data,
      message: "File processed successfully",
    });
  } catch (error) {
    console.error("Forward error:", error.message);

    // Clean up file on error
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    if (error.response) {
      console.error(
        "N8N Response error:",
        error.response.status,
        error.response.data
      );
      res.status(502).json({
        success: false,
        message: `N8N Error: ${error.response.status} - ${JSON.stringify(
          error.response.data
        )}`,
      });
    } else if (error.request) {
      res.status(503).json({
        success: false,
        message: "Cannot reach N8N service",
      });
    } else {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
});

// Add health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", message: "Server is running" });
});

// Add root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Upload server is running",
    endpoints: { upload: "POST /api/upload" },
  });
});

// Start server with error handling
app
  .listen(PORT, () => {
    console.log(`🚀 Backend running on http://localhost:${PORT}`);
  })
  .on("error", (err) => {
    console.error("Server error:", err);
    process.exit(1);
  });

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});
