import express from 'express';
import lighthouse from 'lighthouse';
import chromeLauncher from 'chrome-launcher';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

// FIXED: Allow all origins - no CORS restrictions
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK', service: 'Lighthouse DOM Analysis - CORS Fixed' });
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
    
    // FIXED: Proper DOM data extraction
    if (audits['dom-size']) {
      console.log('📊 DOM-size audit found:', audits['dom-size']);
      
      // Extract DOM nodes from numericValue
      if (audits['dom-size'].numericValue) {
        domNodes = audits['dom-size'].numericValue;
        console.log('🏗️ DOM Nodes from numericValue:', domNodes);
      }
      
      // Extract from details.items array
      if (audits['dom-size'].details && audits['dom-size'].details.items) {
        const items = audits['dom-size'].details.items;
        console.log('📋 DOM items:', items);
        
        // FIXED: Extract actual values correctly
        if (items[0] && typeof items[0].value === 'number') {
          domNodes = Math.max(domNodes, items[0].value);
        } else if (items[0] && items[0].value && typeof items[0].value === 'object' && items[0].value.value) {
          domNodes = Math.max(domNodes, items[0].value.value);
        }
        
        if (items[1]) {
          if (typeof items[1].value === 'number') {
            domDepth = items[1].value;
          } else if (items[1].value && typeof items[1].value === 'object' && items[1].value.value) {
            domDepth = items[1].value.value;
          }
        }
        
        if (items[2]) {
          if (typeof items[2].value === 'number') {
            maxChildren = items[2].value;
          } else if (items[2].value && typeof items[2].value === 'object' && items[2].value.value) {
            maxChildren = items[2].value.value;
          }
        }
      }
    }
    
    console.log('📊 Final values:', { domNodes, domDepth, maxChildren });
    
    // FIXED: Proper crawlability calculation
    let crawlabilityScore = 100;
    const penalties = [];
    
    if (domNodes > 1500) {
      const penalty = Math.min(30, (domNodes - 1500) / 100);
      crawlabilityScore -= penalty;
      penalties.push(`DOM nodes: -${penalty.toFixed(1)}`);
    }
    
    if (domDepth > 32) {
      const penalty = Math.min(20, (domDepth - 32) * 2);
      crawlabilityScore -= penalty;
      penalties.push(`DOM depth: -${penalty.toFixed(1)}`);
    }
    
    if (maxChildren > 60) {
      const penalty = Math.min(25, (maxChildren - 60));
      crawlabilityScore -= penalty;
      penalties.push(`Max children: -${penalty.toFixed(1)} (${maxChildren} > 60 Google limit!)`);
    }
    
    crawlabilityScore = Math.max(0, Math.round(crawlabilityScore));
    
    const crawlabilityRisk = crawlabilityScore >= 80 ? 'LOW' : 
                            crawlabilityScore >= 60 ? 'MEDIUM' : 'HIGH';
    
    console.log('🎯 Crawlability:', crawlabilityScore, '- Risk:', crawlabilityRisk);
    console.log('📉 Penalties:', penalties);
    
    res.json({
      success: true,
      url: url,
      domData: {
        // Clean number values
        dom_nodes: domNodes,
        dom_depth: domDepth,
        max_children: maxChildren,
        crawlability_score: crawlabilityScore,
        crawlability_risk: crawlabilityRisk,
        crawlability_penalties: penalties,
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
  console.log(`🔥 Server running on port ${PORT} - CORS unrestricted`);
});
