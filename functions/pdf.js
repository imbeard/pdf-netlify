const chromium = require('@sparticuz/chromium')
const puppeteer = require("puppeteer-core");
const PDFMerger = require("pdf-merger-js"); 

// Global browser instance for reuse
let globalBrowser = null;

// Browser lifecycle management
async function getBrowser() {
  if (globalBrowser && globalBrowser.isConnected()) {
    return globalBrowser;
  }
  
  globalBrowser = await puppeteer.launch({
    args: [
      ...chromium.args,
      '--disable-dev-shm-usage',
      '--disable-setuid-sandbox',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ],
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: 'new' // Use new headless mode
  });
  
  return globalBrowser;
}

// Optimized PDF options
const PDF_OPTIONS = {
  format: 'a4',
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: '1px', right: '0px', bottom: '1px', left: '0px' }
};

// Navigation options for faster loading
const NAV_OPTIONS = {
  waitUntil: 'domcontentloaded', // Changed from 'networkidle2' for speed
  timeout: 8000 // 8 second timeout per page
};

exports.handler = async (event, context) => {
  // Set function timeout buffer
  const timeoutBuffer = 2000; // 2 seconds buffer
  const startTime = Date.now();
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': true,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE'
  };

  if(event.httpMethod === 'OPTIONS'){
    return {
      statusCode: 200,
      headers,
      body: 'This was a preflight call!'
    };
  }

  if(event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ message: 'Method not allowed' })
    };
  }

  let browser = null;
  let page = null;

  try {
    const { pageToPdf } = JSON.parse(event.body);

    if (!pageToPdf) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'Page URL not defined' }),
      };
    }

    // Check if we're approaching timeout
    const checkTimeout = () => {
      return (Date.now() - startTime) > (10000 - timeoutBuffer);
    };

    browser = await getBrowser();
    page = await browser.newPage();
    
    // Optimize page settings
    await page.setDefaultNavigationTimeout(8000);
    await page.setDefaultTimeout(8000);
    
    // Disable images and CSS for faster loading (optional)
    // await page.setRequestInterception(true);
    // page.on('request', (req) => {
    //   if(req.resourceType() == 'stylesheet' || req.resourceType() == 'image'){
    //     req.abort();
    //   } else {
    //     req.continue();
    //   }
    // });

    if (Array.isArray(pageToPdf)) {
      // Handle multiple pages with timeout checks
      const merger = new PDFMerger();
      const maxPages = Math.min(pageToPdf.length, 5); // Limit pages to avoid timeout
      
      for (let i = 0; i < maxPages; i++) {
        if (checkTimeout()) {
          throw new Error('Timeout approaching - processed partial results');
        }
        
        const url = pageToPdf[i];
        try {
          await page.goto(url, NAV_OPTIONS);
          
          // Wait for essential content only
          await page.evaluate(() => {
            return new Promise((resolve) => {
              if (document.readyState === 'complete') {
                resolve();
              } else {
                window.addEventListener('load', resolve);
                // Fallback timeout
                setTimeout(resolve, 2000);
              }
            });
          });
          
          const pdfBuffer = await page.pdf(PDF_OPTIONS);
          await merger.add(pdfBuffer);
        } catch (pageError) {
          console.error(`Error processing page ${url}:`, pageError);
          // Continue with other pages instead of failing completely
        }
      }

      const mergedPdfBuffer = await merger.saveAsBuffer();
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: `PDF file multipage (${maxPages}/${pageToPdf.length} pages)`,
          pdfBlob: Buffer.from(mergedPdfBuffer).toString('base64'),
          processedPages: maxPages,
          totalPages: pageToPdf.length
        }),
      };
      
    } else {
      // Single page processing
      await page.goto(pageToPdf, NAV_OPTIONS);
      
      // Wait for essential content
      await page.evaluate(() => {
        return new Promise((resolve) => {
          if (document.readyState === 'complete') {
            resolve();
          } else {
            window.addEventListener('load', resolve);
            setTimeout(resolve, 2000); // Fallback
          }
        });
      });
      
      const pdf = await page.pdf({
        ...PDF_OPTIONS,
        scale: 0.5,
        displayHeaderFooter: true,
        headerTemplate:`<div class="border-b border-black my-4 pb-2 flex-shrink-0">
                        <img src="https://nilufar.com/wp-content/uploads/2024/10/logo.svg" class="w-64 py-4" />
                    </div>`,
        footerTemplate:` <div class="border-t border-black flex justify-between text-lg pb-8 flex-shrink-0">
                       <div>
                                General requests: nilufar@nilufar.com<br/>
                                Customer service: customerservice@nilufar.com
                      </div>
                       <div>
                                Gallery - Via della Spiga 32, Milan - +39 02 780193<br/>
                                Depot - Viale Vincenzo Lancetti 34, Milan - +39 02 36590800
                      </div>
                    </div>`,
         margin: {
          top: '1px',    // Top margin
          bottom: '1px', // Bottom margin
        }
      });
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: `PDF file ${pageToPdf}`,
          pdfBlob: Buffer.from(pdf).toString('base64'),
        }),
      };
    }

  } catch (error) {
    console.error('PDF generation error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        message: 'PDF generation failed', 
        error: error.message 
      }),
    };
    
  } finally {
    // Clean up page but keep browser for reuse
    if (page) {
      try {
        await page.close();
      } catch (e) {
        console.error('Error closing page:', e);
      }
    }
    
    // Only close browser if we're running out of memory or on cold start
    // This is optional - you might want to keep it open for performance
    if (context.getRemainingTimeInMillis && context.getRemainingTimeInMillis() < 1000) {
      if (globalBrowser) {
        try {
          await globalBrowser.close();
          globalBrowser = null;
        } catch (e) {
          console.error('Error closing browser:', e);
        }
      }
    }
  }
};
