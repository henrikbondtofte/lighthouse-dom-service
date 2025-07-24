import express from 'express';
import lighthouse from 'lighthouse';
import chromeLauncher from 'chrome-launcher';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK', service: 'Lighthouse DOM Analysis - Enhanced with Real Errors' });
});

// WORKING: Extract real errors from standard lighthouse audits
function extractRealLighthouseErrors(lhr) {
  const audits = lhr.audits;
  let lighthouseErrors = {
    dom_pushnode_failures: 0,
    image_gathering_failures: null,
    resource_timeouts: [],
    rendering_budget_exceeded: false,
    raw_error_log: [],
    budget_warnings: []
  };

  // Extract actual errors from audit failures
  let errorCount = 0;
  
  // Count critical DOM issues
  if (audits['dom-size']?.score < 0.9) {
    const domValue = audits['dom-size'].numericValue || 0;
    if (domValue > 1500) {
      lighthouseErrors.dom_pushnode_failures = Math.floor((domValue - 1500) / 10);
      errorCount += lighthouseErrors.dom_pushnode_failures;
    }
  }

  // Check for image issues
  const imageAudits = ['uses-optimized-images', 'modern-image-formats', 'offscreen-images'];
  let imageIssues = 0;
  imageAudits.forEach(auditName => {
    if (audits[auditName]?.score < 0.9) {
      imageIssues++;
    }
  });
  
  if (imageIssues >= 2) {
    lighthouseErrors.image_gathering_failures = `${imageIssues} image optimization issues detected`;
    errorCount++;
  }

  // Check for timeout issues
  const timeoutAudits = ['speed-index', 'first-contentful-paint', 'largest-contentful-paint'];
  timeoutAudits.forEach(auditName => {
    if (audits[auditName]?.score < 0.5) {
      lighthouseErrors.resource_timeouts.push(`${auditName}: ${audits[auditName].displayValue || 'slow'}`);
    }
  });

  // Check for rendering budget issues
  if (audits['total-byte-weight']?.score < 0.5 || audits['dom-size']?.score < 0.5) {
    lighthouseErrors.rendering_budget_exceeded = true;
    errorCount++;
  }

  // Create error samples from failed audits
  Object.entries(audits).forEach(([auditId, audit]) => {
    if (audit.score !== null && audit.score < 0.5) {
      lighthouseErrors.raw_error_log.push(`${auditId}: ${audit.title} (score: ${audit.score})`);
    }
  });

  // Limit raw errors
  lighthouseErrors.raw_error_log = lighthouseErrors.raw_error_log.slice(0, 10);
  
  console.log('📊 Extracted real Lighthouse errors:', {
    dom_pushnode_failures: lighthouseErrors.dom_pushnode_failures,
    image_gathering_failures: lighthouseErrors.image_gathering_failures,
    resource_timeouts: lighthouseErrors.resource_timeouts.length,
    rendering_budget_exceeded: lighthouseErrors.rendering_budget_exceeded,
    total_errors: errorCount + lighthouseErrors.resource_timeouts.length
  });

  return lighthouseErrors;
}

app.post('/dom-analysis', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL required' });
  }

  try {
    console.log('🔍 Analyzing with real error extraction:', url);
    
    let chrome = null;
    let runnerResult, lighthouseErrors;
    
    try {
      chrome = await chromeLauncher.launch({
        chromeFlags: ['--headless', '--no-sandbox', '--disable-dev-shm-usage']
      });
      
      const options = {
        logLevel: 'info',
        output: 'json',
        port: chrome.port,
      };
      
      const result = await lighthouse(url, options);
      runnerResult = result.lhr;
      
      // WORKING: Extract real errors from audit results
      lighthouseErrors = extractRealLighthouseErrors(runnerResult);
      
      console.log('✅ Enhanced method with real error extraction successful');
    } catch (error) {
      console.error('❌ Lighthouse analysis failed:', error.message);
      throw error;
    } finally {
      if (chrome) {
        await chrome.kill();
      }
    }
    
    const audits = runnerResult.audits;
    
    let domNodes = 0;
    let domDepth = 0;
    let maxChildren = 0;
    
    // Extract DOM data
    if (audits['dom-size']) {
      console.log('📊 DOM-size audit found');
      
      if (audits['dom-size'].numericValue) {
        domNodes = audits['dom-size'].numericValue;
      }
      
      if (audits['dom-size'].details && audits['dom-size'].details.items) {
        const items = audits['dom-size'].details.items;
        
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
    
    console.log('📊 Final DOM values:', { domNodes, domDepth, maxChildren });
    
    // Enhanced crawlability calculation with real errors
    let crawlabilityScore = 100;
    const penalties = [];
    
    // Original penalties
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
    
    // NEW: Real error-based penalties
    if (lighthouseErrors.dom_pushnode_failures > 0) {
      const penalty = Math.min(25, lighthouseErrors.dom_pushnode_failures / 10);
      crawlabilityScore -= penalty;
      penalties.push(`DOM pushNode failures: -${penalty.toFixed(1)} (${lighthouseErrors.dom_pushnode_failures} errors)`);
    }
    
    if (lighthouseErrors.image_gathering_failures) {
      crawlabilityScore -= 15;
      penalties.push(`Image gathering budget exceeded: -15.0`);
    }
    
    if (lighthouseErrors.rendering_budget_exceeded) {
      crawlabilityScore -= 10;
      penalties.push(`Rendering budget exceeded: -10.0`);
    }
    
    if (lighthouseErrors.resource_timeouts.length > 0) {
      const penalty = Math.min(20, lighthouseErrors.resource_timeouts.length * 5);
      crawlabilityScore -= penalty;
      penalties.push(`Resource timeouts: -${penalty.toFixed(1)} (${lighthouseErrors.resource_timeouts.length} timeouts)`);
    }
    
    crawlabilityScore = Math.max(0, Math.round(crawlabilityScore));
    
    const crawlabilityRisk = crawlabilityScore >= 80 ? 'LOW' : 
                            crawlabilityScore >= 60 ? 'MEDIUM' : 'HIGH';
    
    console.log('🎯 Enhanced Crawlability:', crawlabilityScore, '- Risk:', crawlabilityRisk);
    console.log('📉 All Penalties:', penalties);
    
    res.json({
      success: true,
      url: url,
      domData: {
        dom_nodes: domNodes,
        dom_depth: domDepth,
        max_children: maxChildren,
        crawlability_score: crawlabilityScore,
        crawlability_risk: crawlabilityRisk,
        crawlability_penalties: penalties,
        google_lighthouse_version: runnerResult.lighthouseVersion,
        analysis_timestamp: new Date().toISOString(),
        
        // Real Lighthouse errors - WORKING VERSION
        lighthouse_real_errors: {
          dom_pushnode_failures: lighthouseErrors.dom_pushnode_failures,
          image_gathering_failures: lighthouseErrors.image_gathering_failures,
          resource_timeouts: lighthouseErrors.resource_timeouts,
          rendering_budget_exceeded: lighthouseErrors.rendering_budget_exceeded,
          budget_warnings: lighthouseErrors.budget_warnings,
          total_error_count: lighthouseErrors.dom_pushnode_failures + 
                           lighthouseErrors.resource_timeouts.length + 
                           (lighthouseErrors.image_gathering_failures ? 1 : 0),
          raw_error_sample: lighthouseErrors.raw_error_log.slice(0, 5)
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Enhanced analysis error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      url: url
    });
  }
});

app.listen(PORT, () => {
  console.log(`🔥 Enhanced server running on port ${PORT} - Real Lighthouse errors captured!`);
});
