// ===================================
// FILE 2: server.js
// ===================================
const express = require('express');
const lighthouse = require('lighthouse');
const chromeLauncher = require('chrome-launcher');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ['https://trafficl.vercel.app', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'Lighthouse DOM Analysis',
    timestamp: new Date().toISOString()
  });
});

// Main DOM analysis endpoint
app.post('/dom-analysis', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  let chrome = null;
  
  try {
    console.log('🔍 Starting Lighthouse DOM analysis for:', url);
    
    // Launch Chrome
    console.log('🚀 Launching Chrome...');
    chrome = await chromeLauncher.launch({
      chromeFlags: ['--headless', '--no-sandbox', '--disable-dev-shm-usage']
    });
    
    console.log('⚡ Running Lighthouse...');
    
    // Run Lighthouse
    const options = {
      logLevel: 'info',
      output: 'json',
      onlyCategories: ['performance'],
      port: chrome.port,
    };
    
    const runnerResult = await lighthouse(url, options);
    const lighthouseResults = runnerResult.lhr;
    
    console.log('📊 Extracting DOM data...');
    
    // Extract DOM data
    const domData = extractDOMData(lighthouseResults);
    
    console.log('✅ DOM analysis complete:', domData);
    
    res.json({
      success: true,
      url: url,
      domData: domData,
      timestamp: new Date().toISOString(),
      service: 'Railway Lighthouse CLI'
    });
    
  } catch (error) {
    console.error('❌ Lighthouse error:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      url: url,
      service: 'Railway Lighthouse CLI'
    });
  } finally {
    // Always kill Chrome
    if (chrome) {
      await chrome.kill();
      console.log('🔒 Chrome closed');
    }
  }
});

// Extract DOM data from Lighthouse results
function extractDOMData(lighthouseResults) {
  const audits = lighthouseResults.audits;
  
  let domNodes = 0;
  let domDepth = 0;
  let maxChildren = 0;
  
  // Extract DOM size data
  if (audits['dom-size'] && audits['dom-size'].details && audits['dom-size'].details.items) {
    const domItems = audits['dom-size'].details.items;
    console.log('📋 DOM items found:', domItems.length);
    
    if (domItems[0] && domItems[0].value !== undefined) {
      domNodes = domItems[0].value;
      console.log('🏗️ DOM Nodes:', domNodes);
    }
    
    if (domItems[1] && domItems[1].value !== undefined) {
      domDepth = domItems[1].value;
      console.log('📏 DOM Depth:', domDepth);
    }
    
    if (domItems[2] && domItems[2].value !== undefined) {
      maxChildren = domItems[2].value;
      console.log('👶 Max Children:', maxChildren);
    }
  }
  
  // Extract performance metrics
  const performanceMetrics = {
    fcp: audits['first-contentful-paint']?.numericValue || 0,
    lcp: audits['largest-contentful-paint']?.numericValue || 0,
    cls: audits['cumulative-layout-shift']?.numericValue || 0,
    tbt: audits['total-blocking-time']?.numericValue || 0,
    speed_index: audits['speed-index']?.numericValue || 0
  };
  
  // Find DOM-related issues
  const domRelatedIssues = [];
  Object.keys(audits).forEach(auditKey => {
    const audit = audits[auditKey];
    if (audit.score !== null && audit.score < 0.9) {
      if (auditKey.includes('dom') || 
          auditKey.includes('render') || 
          auditKey.includes('layout') ||
          auditKey.includes('paint') ||
          auditKey.includes('blocking')) {
        domRelatedIssues.push({
          audit: auditKey,
          title: audit.title,
          score: audit.score,
          description: audit.description || 'No description available'
        });
      }
    }
  });
  
  // Calculate crawlability score
  let crawlabilityScore = 100;
  
  if (domNodes > 1500) {
    crawlabilityScore -= Math.min(30, (domNodes - 1500) / 100);
  }
  
  if (domDepth > 32) {
    crawlabilityScore -= Math.min(20, (domDepth - 32) * 2);
  }
  
  if (maxChildren > 60) {
    crawlabilityScore -= Math.min(25, (maxChildren - 60));
  }
  
  if (domRelatedIssues.length > 5) {
    crawlabilityScore -= domRelatedIssues.length * 2;
  }
  
  crawlabilityScore = Math.max(0, Math.round(crawlabilityScore));
  
  const crawlabilityRisk = crawlabilityScore >= 80 ? 'LOW' : 
                          crawlabilityScore >= 60 ? 'MEDIUM' : 'HIGH';
  
  return {
    // REAL DOM STRUCTURE DATA
    dom_nodes: domNodes,
    dom_depth: domDepth,
    max_children: maxChildren,
    
    // DOM QUALITY METRICS
    crawlability_score: crawlabilityScore,
    crawlability_risk: crawlabilityRisk,
    dom_issues_count: domRelatedIssues.length,
    
    // PERFORMANCE METRICS
    performance_metrics: performanceMetrics,
    
    // CRITICAL ISSUES
    dom_related_issues: domRelatedIssues,
    
    // METADATA
    google_lighthouse_version: lighthouseResults.lighthouseVersion,
    analysis_timestamp: new Date().toISOString(),
    render_blocking_resources: audits['render-blocking-resources']?.details?.items?.length || 0
  };
}

// Start server
app.listen(PORT, () => {
  console.log(`🔥 Lighthouse DOM Service running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/`);
  console.log(`🎯 DOM Analysis: POST http://localhost:${PORT}/dom-analysis`);
});

// ===================================
// FILE 3: Dockerfile (optional - for better performance)
// ===================================
/*
FROM node:18-slim

# Install Chrome dependencies
RUN apt-get update && apt-get install -y \
  wget \
  gnupg \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install Chrome
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - \
  && echo "deb http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list \
  && apt-get update \
  && apt-get install -y google-chrome-stable \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 3001

CMD ["npm", "start"]
*/
