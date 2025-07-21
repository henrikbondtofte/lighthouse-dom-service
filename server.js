import express from 'express';
import lighthouse from 'lighthouse';
import chromeLauncher from 'chrome-launcher';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK', service: 'Lighthouse DOM Analysis' });
});

app.post('/dom-analysis', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL required' });
  }

  let chrome = null;
  
  try {
    console.log('🔍 Analyzing:', url);
    
    chrome = await chromeLauncher.launch({
      chromeFlags: ['--headless', '--no-sandbox', '--disable-dev-shm-usage']
    });
    
    const options = {
      logLevel: 'info',
      output: 'json',
      port: chrome.port,
    };
    
    const runnerResult = await lighthouse(url, options);
    const audits = runnerResult.lhr.audits;
    
    let domNodes = 0;
    let domDepth = 0;
    let maxChildren = 0;
    
    if (audits['dom-size']) {
      if (audits['dom-size'].numericValue) {
        domNodes = audits['dom-size'].numericValue;
      }
      
      if (audits['dom-size'].details && audits['dom-size'].details.items) {
        const items = audits['dom-size'].details.items;
        if (items[0]) domNodes = Math.max(domNodes, items[0].value || 0);
        if (items[1]) domDepth = items[1].value || 0;
        if (items[2]) maxChildren = items[2].value || 0;
      }
    }
    
    let crawlabilityScore = 100;
    if (domNodes > 1500) crawlabilityScore -= Math.min(30, (domNodes - 1500) / 100);
    if (domDepth > 32) crawlabilityScore -= Math.min(20, (domDepth - 32) * 2);
    if (maxChildren > 60) crawlabilityScore -= Math.min(25, (maxChildren - 60));
    crawlabilityScore = Math.max(0, Math.round(crawlabilityScore));
    
    const crawlabilityRisk = crawlabilityScore >= 80 ? 'LOW' : 
                            crawlabilityScore >= 60 ? 'MEDIUM' : 'HIGH';
    
    console.log('✅ Results:', { domNodes, domDepth, maxChildren, crawlabilityScore });
    
    res.json({
      success: true,
      url: url,
      domData: {
        dom_nodes: domNodes,
        dom_depth: domDepth,
        max_children: maxChildren,
        crawlability_score: crawlabilityScore,
        crawlability_risk: crawlabilityRisk,
        google_lighthouse_version: runnerResult.lhr.lighthouseVersion,
        analysis_timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      url: url
    });
  } finally {
    if (chrome) {
      await chrome.kill();
    }
  }
});

app.listen(PORT, () => {
  console.log(`🔥 Server running on port ${PORT}`);
});
