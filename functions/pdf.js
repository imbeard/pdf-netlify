const chromium = require('@sparticuz/chromium')
const puppeteer = require("puppeteer-core");
const PDFMerger = require("pdf-merger-js"); 



exports.handler = async (event, context) => {

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': true,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE'
  };

  if(event.httpMethod == 'OPTIONS'){

      return {
        statusCode: 200, // <-- Must be 200 otherwise pre-flight call fails
        headers,
        body: 'This was a preflight call!'
      };
  }
  if(event.httpMethod == 'POST'){
    const pageToPdf = JSON.parse(event.body).pageToPdf

    if (!pageToPdf)
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'Page URL not defined' }),
      }

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: true, //chromium.headless,
    })
    
    const page = await browser.newPage()
  if(Array.isArray(pageToPdf)){
      const merger = new PDFMerger();
      for (const url of pageToPdf) {
          await page.goto(url, { waitUntil: 'networkidle2' }); 
          await merger.add(await page.pdf({ format: 'a4', printBackground: true,
    margin: {top: '50px', right: '0px', bottom: '10px', left: '0px', }}));
        }
    await browser.close()
        const mergedPdfBuffer = await merger.saveAsBuffer();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: `Pdf file multipage`,
          pdfBlob: Buffer.from(mergedPdfBuffer).toString('base64'),
        }),
      }
      
    }
    else{  
      await page.goto(pageToPdf, { waitUntil: 'networkidle2' })
    const pdf = await page.pdf({ format: 'a4', scale: 0.5, printBackground: true,displayHeaderFooter: true,headerTemplate: '<div style="font-size:16px;width:100%;text-align:center;"></div>',
    footerTemplate: `<div style="font-size:16px;width:100%;text-align:center;"></div>`,
    margin: {top: '50px', right: '0px', bottom: '10px', left: '0px', }})
    await browser.close()
    
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: `Pdf file ${pageToPdf}`,
          pdfBlob: Buffer.from(pdf).toString('base64'),
        }),
      }
      
    }




  }
}
