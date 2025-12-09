generatePDF(id, pdftitle) {
  document.getElementById('pdfprompt').classList.remove('hidden');
  const pageToPdf = 'https://nilufar.com?print=1&id=' + id;
  const options = {
    method: 'POST',
    body: JSON.stringify({
      pageToPdf,
      productId: id,           // Added
      productName: pdftitle    // Added
    }),
  };
  
  document.getElementById('pdfprompt').textContent = 'PDF is being generated... please wait';
  
  fetch('https://venerable-dango-41a0ba.netlify.app/.netlify/functions/pdf', options)
    .then((res) => {
      if (!res.ok) {
        throw new Error('PDF generation failed');
      }
      return res.blob();  // Changed from res.json()
    })
    .then((blob) => {
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const downloadLink = document.createElement('a');
      downloadLink.href = url;
      downloadLink.download = `${pdftitle}-${id}.pdf`;
      downloadLink.textContent = `${pdftitle}-${id}.pdf`;
      
      document.getElementById('pdfprompt').innerHTML = downloadLink.outerHTML;
      
      // Auto-trigger download
      downloadLink.click();
      
      // Cleanup
      setTimeout(() => window.URL.revokeObjectURL(url), 100);
    })
    .catch((err) => {
      console.log('Request error', err);
      document.getElementById('pdfprompt').textContent = `Error: ${err.toString()}`;
    });
}
