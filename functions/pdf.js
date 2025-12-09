const chromium = require('@sparticuz/chromium')
const puppeteer = require("puppeteer-core");
const PDFMerger = require("pdf-merger-js");
const { getStore } = require('@netlify/blobs');

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
    headless: 'new'
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
  waitUntil: 'domcontentloaded',
  timeout: 8000
};

exports.handler = async (event, context) => {
  const timeoutBuffer = 2000;
  const startTime = Date.now();
  
  const headers = {
    'Access-Control-Allow-Origin': '*', // Fixed: removed credentials conflict
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE'
  };

  if(event.httpMethod === 'OPTIONS'){
    return {
      statusCode: 200,
      headers,
      body: ''
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

    const checkTimeout = () => {
      return (Date.now() - startTime) > (10000 - timeoutBuffer);
    };

    browser = await getBrowser();
    page = await browser.newPage();
    
    await page.setDefaultNavigationTimeout(8000);
    await page.setDefaultTimeout(8000);

    let pdfBuffer;
    let pageInfo = {};

    if (Array.isArray(pageToPdf)) {
      const merger = new PDFMerger();
      const maxPages = Math.min(pageToPdf.length, 5);
      
      for (let i = 0; i < maxPages; i++) {
        if (checkTimeout()) {
          throw new Error('Timeout approaching - processed partial results');
        }
        
        const url = pageToPdf[i];
        try {
          await page.goto(url, NAV_OPTIONS);
          
          await page.evaluate(() => {
            return new Promise((resolve) => {
              if (document.readyState === 'complete') {
                resolve();
              } else {
                window.addEventListener('load', resolve);
                setTimeout(resolve, 2000);
              }
            });
          });
          
          const pdf = await page.pdf(PDF_OPTIONS);
          await merger.add(pdf);
        } catch (pageError) {
          console.error(`Error processing page ${url}:`, pageError);
        }
      }

      pdfBuffer = await merger.saveAsBuffer();
      pageInfo = {
        processedPages: maxPages,
        totalPages: pageToPdf.length
      };
      
    } else {
      await page.goto(pageToPdf, NAV_OPTIONS);
      
      await page.evaluate(() => {
        return new Promise((resolve) => {
          if (document.readyState === 'complete') {
            resolve();
          } else {
            window.addEventListener('load', resolve);
            setTimeout(resolve, 2000);
          }
        });
      });
      
      pdfBuffer = await page.pdf({
        ...PDF_OPTIONS,
        scale: 0.5,
        displayHeaderFooter: false,
        margin: {
          top: '1px',
          bottom: '1px',
        }
      });
    }

    // Store PDF in Netlify Blobs
    const store = getStore('pdfs');
    const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.pdf`;
    
    await store.set(filename, pdfBuffer, {
      metadata: { 
        contentType: 'application/pdf',
        createdAt: new Date().toISOString()
      }
    });
    
    // Return URL instead of base64
    const pdfUrl = `${process.env.URL}/.netlify/blobs/serve/pdfs/${filename}`;
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'PDF generated successfully',
        pdfUrl: pdfUrl,
        filename: filename,
        ...pageInfo
      }),
    };

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
    if (page) {
      try {
        await page.close();
      } catch (e) {
        console.error('Error closing page:', e);
      }
    }
    
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
