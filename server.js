import express from 'express';
import lighthouse from 'lighthouse';
import chromeLauncher from 'chrome-launcher';
import cors from 'cors';

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
    service: 'Lighthouse DOM Analysis - ES Modules',
    timestamp: new Date().toISOString(),
    version: '2.0.0'
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
      chromeFlags: ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    
    console.log('⚡ Running Lighthouse on port:', chrome.port);
    
    // Run Lighthouse
    const options = {
      logLevel: 'info',
      output: 'json',
      onlyCategories: ['performance'],
      port: chrome.port,
    };
    
    const runnerResult = await lighthouse(url, options);
    const lighthouseResults = runnerResult.lhr;
    
    console.log('📊 Lighthouse version:', lighthouseResults.lighthouseVersion);
    
    // Extract DOM data
    const domData = extractDOMData(lighthouseResults);
    
    console.log('✅ DOM analysis complete - nodes:', domData.dom_nodes, 'depth:', domData.dom_depth);
    
    res.json({
      success: true,
      url: url,
      domData: domData,
      timestamp: new Date().toISOString(),
      service: 'Railway Lighthouse CLI v2.0',
      lighthouse_version: lighthouseResults.lighthouseVersion
    });
    
  } catch (error) {
    console.error('❌ Lighthouse error:', error.message);
    console.error('Error details:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      url: url,
      service: 'Railway Lighthouse CLI v2.0',
      errorType: error.constructor.name
    });
  } finally {
    // Always kill Chrome
    if (chrome) {
      try {
        await chrome.kill();
        console.log('🔒 Chrome closed successfully');
      } catch (killError) {
        console.log('⚠️ Chrome kill warning:', killError.message);
      }
    }
  }
});

// Extract DOM data from Lighthouse results
function extractDOMData(lighthouseResults) {
  console.log('🔍 Extracting DOM data from Lighthouse results...');
  
  const audits = lighthouseResults.audits;
  
  let domNodes = 0;
  let domDepth = 0;
  let maxChildren = 0;
  
  // Extract DOM size data - REAL LIGHTHOUSE DATA
  if (audits['dom-size']) {
    console.log('📊 DOM-size audit found');
    
    // Try numericValue first
    if (audits['dom-size'].numericValue)
