// Temporary script to download Google Fonts woff2 files for local bundling.
// Run with: node _download-fonts.mjs
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import https from 'https';

const FONTS_DIR = 'public/fonts';

// We need to send a modern user-agent so Google returns woff2 format
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CSS_URLS = [
  // Bricolage Grotesque, Tiny5, Cinzel, Outfit
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;500;600;700;800&family=Tiny5&family=Cinzel:wght@400..900&family=Outfit:wght@300;400;500;600;700;800;900&display=swap',
  // DM Sans, Inter
  'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800&family=Inter:wght@400;500;600;700;800&display=swap',
  // Montserrat (used in wrapped.js)
  'https://fonts.googleapis.com/css2?family=Montserrat:wght@500;700;900&display=swap',
];

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  if (!existsSync(FONTS_DIR)) await mkdir(FONTS_DIR, { recursive: true });
  
  let allCss = '';
  const downloaded = new Set();
  
  for (const cssUrl of CSS_URLS) {
    console.log(`\nFetching CSS: ${cssUrl.slice(0, 80)}...`);
    const cssBuffer = await fetchUrl(cssUrl);
    let css = cssBuffer.toString('utf-8');
    
    // Find all woff2 URLs in the CSS
    const urlRegex = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/g;
    let match;
    while ((match = urlRegex.exec(css)) !== null) {
      const fontUrl = match[1];
      if (downloaded.has(fontUrl)) continue;
      downloaded.add(fontUrl);
      
      // Create a local filename from the URL
      const parts = fontUrl.split('/');
      const filename = parts.slice(-2).join('-').replace(/[^a-zA-Z0-9._-]/g, '_');
      const localPath = `${FONTS_DIR}/${filename}`;
      
      console.log(`  Downloading: ${filename}`);
      const fontData = await fetchUrl(fontUrl);
      await writeFile(localPath, fontData);
      
      // Replace the URL in CSS
      css = css.split(fontUrl).join(`/fonts/${filename}`);
    }
    
    allCss += css + '\n';
  }
  
  // Write the combined CSS
  await writeFile(`${FONTS_DIR}/fonts.css`, allCss);
  console.log(`\nDone! Downloaded ${downloaded.size} font files.`);
  console.log(`Combined CSS written to ${FONTS_DIR}/fonts.css`);
}

main().catch(console.error);




