import express from 'express';
import lighthouse from 'lighthouse';
import chromeLauncher from 'chrome-launcher';
import cors from 'cors';
import { spawn } from 'child_process';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK', service: 'Lighthouse DOM Analysis - Real Error Capture' });
});

// NEW: Run Lighthouse CLI to capture real stderr errors
function runLighthouseCLI(url) {
  return new Promise((resolve, reject) => {
    console.log('🔍 Running Lighthouse CLI to capture REAL stderr for:', url);
    
    const lighthouse = spawn('npx', [
      'lighthouse', 
      url, 
      '--output=json', 
      '--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage',
      '--throttling-method=devtools'
    ], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let jsonOutput = '';
    let stderrOutput = '';
    
    lighthouse.stdout.on('data', (data) => {
      const chunk = data.toString();
      jsonOutput += chunk;
      
      // Also check stdout for status messages with errors
      if (chunk.includes('ImageElements:warn') || 
          chunk.includes('DOM.pushNodeByPathToFrontend') ||
          chunk.includes('timeout') ||
          chunk.includes('budget exceeded')) {
        console.log('🔍 STDOUT ERROR LINE:', chunk.trim());
        stderrOutput += chunk; // Treat as error output
      }
    });
    
    lighthouse.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderrOutput += chunk;
      console.log('🔍 STDERR LINE:', chunk.trim());
    });
    
    lighthouse.on('close', (code) => {
      console.log('📊 Lighthouse CLI finished with code:', code);
      console.log('📊 Total error output length:', stderrOutput.length);
      
      try {
        // Find JSON in output (might be mixed with other text)
        const jsonStart = jsonOutput.indexOf('{');
        const jsonEnd = jsonOutput.lastIndexOf('}') + 1;
        
        if (jsonStart === -1 || jsonEnd === 0) {
          throw new Error('No valid JSON found in Lighthouse output');
        }
        
        const jsonPart = jsonOutput.substring(jsonStart, jsonEnd);
        const result = JSON.parse(jsonPart);
        
        // Parse real errors from stderr + stdout
        const realErrors = parseRealLighthouseErrors(stderrOutput);
        
        resolve({ lhr: result, realErrors });
      } catch (error) {
        console.error('❌ Failed to parse Lighthouse CLI output:', error.message);
        console.log('Output preview:', jsonOutput.substring(0, 500));
        reject(error);
      }
    });
    
    lighthouse.on('error', (error) => {
      console.error('❌ Lighthouse CLI spawn error:', error.message);
      reject(error);
    });
    
    // Timeout after 60 seconds
    setTimeout(() => {
      lighthouse.kill();
      reject(new Error('Lighthouse CLI timeout after 60 seconds'));
    }, 60000);
  });
}

// Parse ONLY real errors from stderr/stdout - no artificial calculations
function parseRealLighthouseErrors(errorOutput) {
  console.log('🔍 Parsing real errors from output:', errorOutput.substring(0, 300));
  
  let realErrors = {
    dom_pushnode_failures: 0,
    image_gathering_failures: null,
    resource_timeouts: [],
    rendering_budget_exceeded: false,
    raw_stderr_lines: [],
    method: 'CLI_REAL_CAPTURE'
  };
  
  const lines = errorOutput.split('\n');
  
  lines.forEach(line => {
    const trimmedLine = line.trim();
    if (!trimmedLine) return;
    
    // Store all error lines for debugging
    realErrors.raw_stderr_lines.push(trimmedLine);
    
    // REAL DOM pushNode failures - exact pattern matching
    if (trimmedLine.includes('DOM.pushNodeByPathToFrontend') && 
        (trimmedLine.includes('failed') || trimmedLine.includes('error'))) {
      realErrors.dom_pushnode_failures++;
      console.log('✅ Found REAL pushNode error:', trimmedLine);
    }
    
    // REAL Image gathering budget - exact pattern matching
    if (trimmedLine.includes('ImageElements:warn') && 
        (trimmedLine.includes('Skipped extra details') || 
         trimmedLine.includes('gathering budget') ||
         trimmedLine.includes('Reached gathering budget'))) {
      
      // Extract numbers like "69/86" from the error message
      const match = trimmedLine.match(/(\d+)\/(\d+)/);
      if (match) {
        realErrors.image_gathering_failures = `${match[1]}/${match[2]} images skipped - gathering budget exceeded`;
        console.log('✅ Found REAL image budget error:', realErrors.image_gathering_failures);
      } else {
        realErrors.image_gathering_failures = "Image gathering budget exceeded";
        console.log('✅ Found REAL image budget error (no numbers)');
      }
    }
    
    // REAL Resource timeouts - look for timeout keywords
    if ((trimmedLine.includes('timeout') || trimmedLine.includes('Timeout')) &&
        !trimmedLine.includes('ImageElements')) { // Exclude image timeout messages
      
      // Try to extract timing info
      const timeMatch = trimmedLine.match(/(\d+\.?\d*)[sm]/);
      if (timeMatch) {
        realErrors.resource_timeouts.push(`Resource timeout: ${timeMatch[0]}`);
        console.log('✅ Found REAL resource timeout:', timeMatch[0]);
      } else {
        realErrors.resource_timeouts.push(`Timeout detected: ${trimmedLine.substring(0, 50)}...`);
        console.log('✅ Found REAL resource timeout (generic)');
      }
    }
    
    // REAL Rendering budget exceeded
    if (trimmedLine.includes('rendering budget') || 
        trimmedLine.includes('budget exceeded') ||
        trimmedLine.includes('performance budget')) {
      realErrors.rendering_budget_exceeded = true;
      console.log('✅ Found REAL rendering budget error');
    }
  });
  
  console.log('🎯 REAL errors extracted:', {
    dom_pushnode_failures: realErrors.dom_pushnode_failures,
    image_gathering_failures: realErrors.image_gathering_failures,
    resource_timeouts: realErrors.resource_timeouts.length,
    rendering_budget_exceeded: realErrors.rendering_budget_exceeded,
    total_stderr_lines: realErrors.raw_stderr_lines.length
  });
  
  return realErrors;
}

// Fallback: Library method with NO artificial errors
function extractBasicLighthouseData(lhr) {
  console.log('⚠️ Using fallback method - no real error capture available');
  
  return {
    dom_pushnode_failures: 0,
    image_gathering_failures: null,
    resource_timeouts: [],
    rendering_budget_exceeded: false,
    raw_stderr_lines: ['Library method - no stderr available'],
    method: 'LIBRARY_FALLBACK'
  };
}

app.post('/dom-analysis', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL required' });
  }

  try {
    console.log('🔍 Starting REAL error capture analysis for:', url);
    
    let lighthouseErrors, runnerResult;
    let analysisMethod = 'UNKNOWN';
    
    // Try CLI method first for real stderr capture
    try {
      console.log('🔄 Attempting CLI method for real error capture...');
      const cliResult = await runLighthouseCLI(url);
      runnerResult = cliResult.lhr;
      lighthouseErrors = cliResult.realErrors;
      analysisMethod = 'CLI_REAL_ERRORS';
      console.log('✅ CLI method successful - real errors captured!');
    } catch (cliError) {
      console.log('⚠️ CLI method failed:', cliError.message);
      console.log('🔄 Falling back to library method...');
      
      // Fallback: Library method without artificial errors
      const chrome = await chromeLauncher.launch({
        chromeFlags: ['--headless', '--no-sandbox', '--disable-dev-shm-usage']
      });
      
      try {
        const options = {
          logLevel: 'info',
          output: 'json', 
          port: chrome.port,
        };
        
        const result = await lighthouse(url, options);
        runnerResult = result.lhr;
        lighthouseErrors = extractBasicLighthouseData(result.lhr);
        analysisMethod = 'LIBRARY_FALLBACK';
        console.log('✅ Library fallback successful');
      } finally {
        await chrome.kill();
      }
    }
    
    const audits = runnerResult.audits;
    
    let domNodes = 0;
    let domDepth = 0;
    let maxChildren = 0;
    
    // Extract DOM data (this part works perfectly - keep unchanged)
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
    
    // Calculate penalties - DOM structure penalties + REAL error penalties
    let crawlabilityScore = 100;
    const penalties = [];
    
    // DOM structure penalties (these are based on real DOM measurements)
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
    
    // REAL ERROR PENALTIES - only applied if we have actual errors from stderr
    if (lighthouseErrors.dom_pushnode_failures > 0) {
      const penalty = Math.min(25, lighthouseErrors.dom_pushnode_failures * 2);
      crawlabilityScore -= penalty;
      penalties.push(`DOM pushNode failures: -${penalty.toFixed(1)} (${lighthouseErrors.dom_pushnode_failures} REAL errors)`);
    }
    
    if (lighthouseErrors.image_gathering_failures) {
      crawlabilityScore -= 15;
      penalties.push(`Image gathering budget exceeded: -15.0 (REAL Lighthouse error)`);
    }
    
    if (lighthouseErrors.rendering_budget_exceeded) {
      crawlabilityScore -= 10;
      penalties.push(`Rendering budget exceeded: -10.0 (REAL Lighthouse error)`);
    }
    
    if (lighthouseErrors.resource_timeouts.length > 0) {
      const penalty = Math.min(20, lighthouseErrors.resource_timeouts.length * 5);
      crawlabilityScore -= penalty;
      penalties.push(`Resource timeouts: -${penalty.toFixed(1)} (${lighthouseErrors.resource_timeouts.length} REAL errors)`);
    }
    
    crawlabilityScore = Math.max(0, Math.round(crawlabilityScore));
    
    const crawlabilityRisk = crawlabilityScore >= 80 ? 'LOW' : 
                            crawlabilityScore >= 60 ? 'MEDIUM' : 'HIGH';
    
    console.log('🎯 Crawlability with REAL errors:', crawlabilityScore, '- Risk:', crawlabilityRisk);
    console.log('📉 Penalties applied:', penalties);
    
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
        
        // ONLY real Lighthouse errors from stderr/stdout capture
        lighthouse_real_errors: {
          dom_pushnode_failures: lighthouseErrors.dom_pushnode_failures,
          image_gathering_failures: lighthouseErrors.image_gathering_failures,
          resource_timeouts: lighthouseErrors.resource_timeouts,
          rendering_budget_exceeded: lighthouseErrors.rendering_budget_exceeded,
          budget_warnings: [],
          total_error_count: lighthouseErrors.dom_pushnode_failures + 
                           lighthouseErrors.resource_timeouts.length + 
                           (lighthouseErrors.image_gathering_failures ? 1 : 0),
          raw_error_sample: lighthouseErrors.raw_stderr_lines.slice(0, 5),
          capture_method: analysisMethod
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Real error capture analysis failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      url: url
    });
  }
});

app.listen(PORT, () => {
  console.log(`🔥 Railway server running with REAL ERROR CAPTURE - No artificial data!`);
});
