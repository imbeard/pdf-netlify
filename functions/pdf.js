const { builder } = require("@netlify/functions");
const chromium = require("chrome-aws-lambda");

async function saveToPdf(url) {
    //const browser = await chromium.puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });

     const browser = await chromium.puppeteer.launch({
        executablePath: await chromium.executablePath,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: chromium.headless,
      });

    const page = await browser.newPage();
    await page.goto(url);
    const pdf = await page.pdf({ format: 'a4', scale: 0.5, printBackground: true });
    await browser.close();
    // Return Buffer
    console.log("qui")
    return pdf;
}

// Based on https://github.com/DavidWells/netlify-functions-workshop/blob/master/lessons-code-complete/use-cases/13-returning-dynamic-images/functions/return-image.js
async function handler(event, context) {

  let pathSplit = event.path.split("/").filter(entry => !!entry);
  let [url] = pathSplit;
  url = decodeURIComponent(url);

  try {


    let output = await saveToPdf(url);

    // output to Function logs
    console.log(url);

    return {
      statusCode: 200,
      headers: {
        "content-type": `application/pdf`
      },
      body: output,
      isBase64Encoded: true
    };
  } catch (error) {
    console.log("Error", error);

    return {
      // We need to return 200 here or Firefox won’t display the image
      // HOWEVER a 200 means that if it times out on the first attempt it will stay the default image until the next build.
      statusCode: 200,
      // HOWEVER HOWEVER, we can set a ttl of 3600 which means that the image will be re-requested in an hour.
      ttl: 3600,
      headers: {
        "content-type": "image/svg+xml"
        //"x-error-message": error.message
      },
      body: `<svg version="1.1" id="L4" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 100 100" enable-background="new 0 0 0 0" xml:space="preserve"><circle fill="#000" stroke="none" cx="6" cy="50" r="6"><animate attributeName="opacity" dur="1s" values="0;1;0" repeatCount="indefinite" begin="0.1"/></circle><circle fill="#000" stroke="none" cx="26" cy="50" r="6"><animate attributeName="opacity" dur="1s" values="0;1;0" repeatCount="indefinite" begin="0.2"/></circle><circle fill="#000" stroke="none" cx="46" cy="50" r="6"><animate attributeName="opacity" dur="1s" values="0;1;0" repeatCount="indefinite" begin="0.3"/></circle></svg>`,
      isBase64Encoded: false,
    };
  }
}

exports.handler = builder(handler);
