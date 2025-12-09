import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import PDFMerger from 'pdf-merger-js';
import { getStore } from '@netlify/blobs';

// Global browser instance for reuse
let globalBrowser = null;

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

const PDF_OPTIONS = {
  format: 'a4',
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: '1px', right: '0px', bottom: '1px', left: '0px' }
};

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

  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ message: 'Method not allowed' }), {
      status: 405,
      headers
    });
  }

  let browser = null;
  let page = null;

  try {
    const body = await req.text();
    const { pageToPdf, productId, productName } = JSON.parse(body);

    if (!pageToPdf || !productId || !productName) {
      return new Response(JSON.stringify({ 
        message: 'Missing required fields: pageToPdf, productId, productName' 
      }), {
        status: 400,
        headers
      });
    }

    const store = getStore('pdfs');
    
    // Create sanitized filename with product name
    const sanitizedName = productName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const blobKey = `${sanitizedName}-${productId}`;
    
    // Check if PDF already exists
    const existingBlob = await store.get(blobKey, { type: 'arrayBuffer' });
    
    if (existingBlob) {
      console.log(`Serving cached PDF for ${blobKey}`);
      
      // Convert ArrayBuffer to Buffer
      const buffer = Buffer.from(existingBlob);
      
      // Return cached PDF directly
      return new Response(buffer, {
        status: 200,
        headers: {
          ...headers,
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${sanitizedName}-${productId}.pdf"`
        }
      });
    }

    console.log(`Generating new PDF for ${blobKey}`);

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

    // Store PDF in Netlify Blobs with product ID as key
    await store.set(blobKey, pdfBuffer, {
      metadata: { 
        contentType: 'application/pdf',
        productId: productId,
        productName: productName,
        createdAt: new Date().toISOString()
      }
    });
    
    console.log(`PDF cached as ${blobKey}`);
    
    // Return PDF directly for immediate download
    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${sanitizedName}-${productId}.pdf"`
      }
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
