console.log('Starting Electron Main Process...');

// Electron APIs should be available in main process
let app, BrowserWindow, ipcMain;

// Try to get APIs (Electron makes them available globally in main process)
setTimeout(() => {
  console.log('Checking APIs after timeout');

  // In Electron main process, APIs are available globally
  app = global.app || require('electron').app;
  BrowserWindow = global.BrowserWindow || require('electron').BrowserWindow;
  ipcMain = global.ipcMain || require('electron').ipcMain;

  console.log('App available:', !!app);
  console.log('BrowserWindow available:', !!BrowserWindow);
  console.log('ipcMain available:', !!ipcMain);

  if (!app || !BrowserWindow || !ipcMain) {
    console.error('Electron APIs not found. Exiting.');
    process.exit(1);
  }

  // IPC handlers (must be defined after ipcMain is available)
  ipcMain.handle('get-app-path', () => app.getPath('userData'));

  // Handle table assignment printing
  ipcMain.handle('print-table-assignment', async (event, tableData) => {
    let printWindow = null;
    try {
      const { tableNumber, waiterName } = tableData;

      printWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      const htmlContent = `
        <html>
          <head>
            <style>
              body { font-family: 'Courier New', monospace; font-size: 14px; text-align: center; margin: 20px; }
              .title { font-size: 18px; font-weight: bold; margin-bottom: 10px; }
              .info { margin: 10px 0; }
            </style>
          </head>
          <body>
            <div class="title">THE GREAT OLIVE</div>
            <div class="info">Table Assignment</div>
            <div class="info">Table: ${tableNumber}</div>
            <div class="info">Waiter: ${waiterName}</div>
            <div class="info">Time: ${new Date().toLocaleTimeString()}</div>
          </body>
        </html>
      `;

      const loadPromise = printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Load timeout')), 10000)
      );
      await Promise.race([loadPromise, timeoutPromise]);

      const printOptions = {
        silent: false,
        printBackground: false,
        deviceName: '',
        margins: { marginType: 'none' },
        pageSize: { width: 80000, height: 297000 }
      };

      const printPromise = printWindow.webContents.print(printOptions);
      const printTimeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Print timeout')), 15000)
      );
      const success = await Promise.race([printPromise, printTimeoutPromise]);

      return { success: true, printed: success };
    } catch (error) {
      console.error('Table assignment print error:', error);
      return { success: false, error: error.message };
    } finally {
      if (printWindow && !printWindow.isDestroyed()) {
        printWindow.close();
      }
    }
  });

  // Handle receipt PDF generation
  ipcMain.handle('generate-receipt-pdf', async (event, receiptData) => {
    let printWindow = null;
    try {
      printWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      const receiptHTML = generateReceiptHTML(receiptData);

      const loadPromise = printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(receiptHTML)}`);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Load timeout')), 10000)
      );
      await Promise.race([loadPromise, timeoutPromise]);

      const finishLoadPromise = new Promise(resolve => printWindow.webContents.once('did-finish-load', resolve));
      const finishTimeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Finish load timeout')), 5000)
      );
      await Promise.race([finishLoadPromise, finishTimeoutPromise]);

      await new Promise(resolve => setTimeout(resolve, 500));

      const pdfOptions = {
        marginsType: 0,
        pageSize: 'A4',
        printBackground: false,
        landscape: false
      };

      const pdfBuffer = await printWindow.webContents.printToPDF(pdfOptions);

      return { success: true, pdf: pdfBuffer.toString('base64') };
    } catch (error) {
      console.error('PDF generation error:', error);
      return { success: false, error: error.message };
    } finally {
      if (printWindow && !printWindow.isDestroyed()) {
        printWindow.close();
      }
    }
  });

  // Handle receipt printing
  ipcMain.handle('print-receipt', async (event, receiptData) => {
    let printWindow = null;
    try {
      printWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      const receiptHTML = generateReceiptHTML(receiptData);

      // Load HTML with timeout
      const loadPromise = printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(receiptHTML)}`);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Load timeout')), 10000)
      );
      await Promise.race([loadPromise, timeoutPromise]);

      // Show window briefly to ensure print dialog appears
      printWindow.show();

      // Wait for did-finish-load with timeout
      const finishLoadPromise = new Promise(resolve => printWindow.webContents.once('did-finish-load', resolve));
      const finishTimeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Finish load timeout')), 5000)
      );
      await Promise.race([finishLoadPromise, finishTimeoutPromise]);

      // Additional stabilization time
      await new Promise(resolve => setTimeout(resolve, 500));

      const printOptions = {
        silent: false,
        printBackground: false,
        deviceName: '',
        margins: { marginType: 'none' },
        pageSize: { width: 80000, height: 297000 }
      };

      // Print with timeout
      const printPromise = printWindow.webContents.print(printOptions);
      const printTimeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Print timeout')), 15000)
      );
      const success = await Promise.race([printPromise, printTimeoutPromise]);

      return { success: true, printed: success };
    } catch (error) {
      console.error('Receipt print error:', error);
      return { success: false, error: error.message };
    } finally {
      if (printWindow && !printWindow.isDestroyed()) {
        printWindow.close();
      }
    }
  });

  // Continue with app logic
  runApp();
}, 0);

function runApp() {
  const path = require('path');
  const { spawn } = require('child_process');

  let mainWindow = null;
  let serverProcess = null;

  // Check if we're in development or packaged app
  const isDev = process.env.NODE_ENV === 'development';

  // IPC handlers already defined above

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload/preload.js')
      }
    });

    // Use 5173 which is the default Vite port
    const startUrl = isDev
      ? 'http://localhost:5173'
      : `file://${path.join(__dirname, '../renderer/index.html')}`;

    mainWindow.loadURL(startUrl);

    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      if (isDev) mainWindow.webContents.openDevTools();
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
  });
}
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Receipt</title>
        <style>
          @media print {
            @page {
              size: 90mm auto;
              margin: 0;
            }
          }
          body {
            font-family: 'Courier New', monospace;
            font-size: 11px;
            line-height: 1.3;
            margin: 0;
            padding: 5px;
            width: 100mm;
            max-width: 90mm;
            color: black;
            background: white;
          }
          .center { text-align: center; }
          .bold { font-weight: bold; }
          .line {
            border-bottom: 1px dashed #000;
            margin: 5px 0;
            height: 1px;
            clear: both;
          }
          table { width: 100%; border-collapse: collapse; margin: 0; padding: 0; }
          td { padding: 1px 0; vertical-align: top; }
          .right { text-align: right; }
          .item-name {
            max-width: 35mm;
            word-wrap: break-word;
            overflow-wrap: break-word;
            white-space: normal;
          }
          .item-details { font-size: 10px; color: #666; }
          .total-row { font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="center bold">${receipt.business?.name || 'GREAT OLIVE'}</div>
        <div class="center">${receipt.business?.address || ''}</div>
        <div class="center">${receipt.business?.phone || ''}</div>
        <div class="line"></div>

        <table>
          <tr><td>Invoice:</td><td class="right">${receipt.invoice?.number || ''}</td></tr>
          <tr><td>Date:</td><td class="right">${receipt.invoice?.date || new Date().toLocaleDateString()}</td></tr>
          <tr><td>Table:</td><td class="right">${receipt.invoice?.table || ''}</td></tr>
          <tr><td>Waiter:</td><td class="right">${receipt.invoice?.waiter || ''}</td></tr>
          <tr><td>Cashier:</td><td class="right">${receipt.invoice?.cashier || ''}</td></tr>
        </table>
        <div class="line"></div>

        <table>
          <thead>
            <tr>
              <td class="bold item-name">Item</td>
              <td class="bold right">Qty</td>
              <td class="bold right">Price</td>
              <td class="bold right">Total</td>
            </tr>
          </thead>
          <tbody>
            ${(receipt.items || []).map(item => `
              <tr>
                <td class="item-name">
                  ${item.name}
                  ${item.notes ? `<div class="item-details">${item.notes}</div>` : ''}
                </td>
                <td class="right">${item.quantity || 1}</td>
                <td class="right">$${(item.unitPrice || 0).toFixed(2)}</td>
                <td class="right">$${(item.totalPrice || 0).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="line"></div>

        <table style="width: 100%;">
          <tr>
            <td>Subtotal:</td><td class="right">$${(receipt.totals?.subtotal || 0).toFixed(2)}</td>
          </tr>
          ${(receipt.totals?.discount || 0) > 0 ? `<tr><td>Discount:</td><td class="right">-$${(receipt.totals.discount).toFixed(2)}</td></tr>` : ''}
          <tr>
            <td>Tax:</td><td class="right">$${(receipt.totals?.tax || 0).toFixed(2)}</td>
          </tr>
          <tr class="total-row">
            <td>Total:</td><td class="right">$${(receipt.totals?.total || 0).toFixed(2)}</td>
          </tr>
        </table>
        <div class="line"></div>

        <div>Payment: ${(receipt.payment?.method || '').toUpperCase()}</div>
        <div>Amount Paid: $${(receipt.payment?.amount || 0).toFixed(2)}</div>
        ${(receipt.payment?.change || 0) > 0 ? `<div>Change: $${receipt.payment.change.toFixed(2)}</div>` : ''}
        <div class="line"></div>

        <div class="center">${(receipt.footer || 'Thank you for your visit!').replace(/\\n/g, '<br>')}</div>
      </body>
    </html>
  `;
}

// IPC handlers defined in setTimeout above
