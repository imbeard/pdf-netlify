let HEADERS = {
  'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Access-Control-Allow-Origin',
  'Content-Type': 'application/json', //optional
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '8640'
}

//This solves the "No ‘Access-Control-Allow-Origin’ header is present on the requested resource."

HEADERS['Access-Control-Allow-Origin'] = '*'
HEADERS['Vary'] = 'Origin'

const chromium = require('chrome-aws-lambda')

exports.handler = async (event, context) => {


  const pageToPdf = JSON.parse(event.body).pageToPdf

  if (!pageToPdf)
    return {
      statusCode: 400,
      HEADERS,
      body: JSON.stringify({ message: 'Page URL not defined' }),
    }

  const browser = await chromium.puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    headless: true, //chromium.headless,
  })

  const page = await browser.newPage()

  await page.goto(pageToPdf, { waitUntil: 'networkidle2' })

  const pdf = await page.pdf()

  await browser.close()

  return {
    statusCode: 200,
    HEADERS,
    body: JSON.stringify({
      message: `Pdf file ${pageToPdf}`,
      pdfBlob: pdf.toString('base64'),
    }),
  }
}