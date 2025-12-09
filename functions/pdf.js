import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import PDFMerger from 'pdf-merger-js';
import { getStore } from '@netlify/blobs';

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

export default async (req, context) => {
  const timeoutBuffer = 2000;
  const startTime = Date.now();
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE'
  };

  if(req.method === 'OPTIONS'){
    return new Response('', {
      status: 200,
      headers
    });
  }

  if(req.method !== 'POST') {
    return new Response(JSON.stringify({ message: 'Method not allowed' }), {
      status: 405,
      headers
    });
  }

  let browser = null;
  let page = null;

  try {
    const body = await req.text();
    const { pageToPdf } = JSON.parse(body);

    if (!pageToPdf) {
      return new Response(JSON.stringify({ message: 'Page URL not defined' }), {
        status: 400,
        headers
      });
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
    
    return new Response(JSON.stringify({
      success: true,
      message: 'PDF generated successfully',
      pdfUrl: pdfUrl,
      filename: filename,
      ...pageInfo
    }), {
      status: 200,
      headers
    });

  } catch (error) {
    console.error('PDF generation error:', error);
    
    return new Response(JSON.stringify({ 
      message: 'PDF generation failed', 
      error: error.message 
    }), {
      status: 500,
      headers
    });
    
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
