import express from 'express';
import lighthouse from 'lighthouse';
import chromeLauncher from 'chrome-launcher';
import cors from 'cors';
import { spawn } from 'child_process';
import { promisify } from 'util';

const app = express();
const PORT = process.env.PORT || 3001;

// FIXED: Allow all origins - no CORS restrictions
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK', service: 'Lighthouse DOM Analysis - Enhanced with Real Errors' });
});

// NEW: Function to run Lighthouse CLI and capture real errors
async function runLighthouseWithErrorCapture(url) {
  return new Promise((resolve, reject) => {
    console.log('🔍 Running enhanced Lighthouse with error capture for:', url);
    
    // Run lighthouse CLI to capture stderr output
    const lighthouse = spawn('npx', [
      'lighthouse', 
      url, 
      '--output=json', 
      '--chrome-flags=--headless',
      '--preset=desktop',
      '--quiet'
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    let lighthouseErrors = {
      dom_pushnode_failures: 0,
      image_gathering_failures: null,
      resource_timeouts: [],
      rendering_budget_exceeded: false,
      raw_error_log: [],
      budget_warnings: []
    };
    
    // Capture stdout (JSON result)
    lighthouse.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    // Capture stderr (where the good stuff is!)
    lighthouse.stderr.on('data', (data) => {
      const errorOutput = data.toString();
      stderr += errorOutput;
      
      // Parse specific error patterns
      const lines = errorOutput.split('\n');
      
      lines.forEach(line => {
        // Count DOM.pushNodeByPathToFrontend errors
        if (line.includes('DOM.pushNodeByPathToFrontend')) {
          lighthouseErrors.dom_pushnode_failures++;
          if (lighthouseErrors.raw_error_log.length < 10) { // Limit log size
            lighthouseErrors.raw_error_log.push(line.trim());
          }
        }
        
        // Capture image gathering budget warnings
        if (line.includes('ImageElements:warn') && line.includes('gathering budget')) {
          const match = line.match(/Skipped extra details for (\d+)\/(\d+)/);
          if (match) {
            lighthouseErrors.image_gathering_failures = `${match[1]}/${match[2]} images skipped - gathering budget exceeded`;
          }
          lighthouseErrors.budget_warnings.push(line.trim());
        }
        
        // Capture other budget exceeded warnings
        if (line.includes('budget') && (line.includes('exceeded') || line.includes('Reached'))) {
          lighthouseErrors.rendering_budget_exceeded = true;
          lighthouseErrors.budget_warnings.push(line.trim());
        }
        
        // Capture timeout issues
        if (line.includes('timeout') || line.includes('Timeout')) {
          lighthouseErrors.resource_timeouts.push(line.trim());
        }
        
        // Capture other relevant errors
        if ((line.includes('ERR:error') || line.includes('WARN:')) && 
            !line.includes('DOM.pushNodeByPathToFrontend')) {
          if (lighthouseErrors.raw_error_log.length < 20) {
            lighthouseErrors.raw_error_log.push(line.trim());
          }
        }
      });
    });
    
    lighthouse.on('close', (code) => {
      try {
        // Parse the JSON result
        const result = JSON.parse(stdout);
        
        console.log('📊 Captured Lighthouse errors:', {
          dom_pushnode_failures: lighthouseErrors.dom_pushnode_failures,
          image_gathering_failures: lighthouseErrors.image_gathering_failures,
          budget_warnings: lighthouseErrors.budget_warnings.length,
          resource_timeouts: lighthouseErrors.resource_timeouts.length
        });
        
        resolve({ 
          lhr: result, 
          lighthouseErrors 
        });
      } catch (error) {
        reject(new Error(`Failed to parse Lighthouse output: ${error.message}`));
      }
    });
    
    lighthouse.on('error', (error) => {
      reject(error);
    });
  });
}

app.post('/dom-analysis', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL required' });
  }

  try {
    console.log('🔍 Analyzing with enhanced error capture:', url);
    
    // Run enhanced Lighthouse with error capture
    const { lhr: runnerResult, lighthouseErrors } = await runLighthouseWithErrorCapture(url);
    const audits = runnerResult.audits;
    
    let domNodes = 0;
    let domDepth = 0;
    let maxChildren = 0;
    
    // EXISTING: Proper DOM data extraction
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
        
        // EXISTING: Extract actual values correctly
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
    
    // ENHANCED: Crawlability calculation with real errors
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
        // EXISTING: Clean number values
        dom_nodes: domNodes,
        dom_depth: domDepth,
        max_children: maxChildren,
        crawlability_score: crawlabilityScore,
        crawlability_risk: crawlabilityRisk,
        crawlability_penalties: penalties,
        google_lighthouse_version: runnerResult.lighthouseVersion,
        analysis_timestamp: new Date().toISOString(),
        
        // NEW: Real Lighthouse errors
        lighthouse_real_errors: {
          dom_pushnode_failures: lighthouseErrors.dom_pushnode_failures,
          image_gathering_failures: lighthouseErrors.image_gathering_failures,
          resource_timeouts: lighthouseErrors.resource_timeouts,
          rendering_budget_exceeded: lighthouseErrors.rendering_budget_exceeded,
          budget_warnings: lighthouseErrors.budget_warnings,
          total_error_count: lighthouseErrors.dom_pushnode_failures + 
                           lighthouseErrors.resource_timeouts.length + 
                           (lighthouseErrors.image_gathering_failures ? 1 : 0),
          raw_error_sample: lighthouseErrors.raw_error_log.slice(0, 5) // First 5 errors
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
