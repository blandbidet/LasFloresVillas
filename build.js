#!/usr/bin/env node


const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SITE_URL  = 'https://villas-stjohn.com'; 
const SITE_NAME = 'Las Flores Villas';
const ADDRESS = {
  street: '211 Chocolate Hole', locality: 'Cruz Bay',
  region: 'St. John', postal: '00830', country: 'VI',
};

const ROOT = __dirname;
const SRC  = path.join(ROOT, 'src', 'index.html');

if (!fs.existsSync(SRC)) {
  console.error(`\nERROR: ${SRC} not found.\n` +
    `Create a folder called "src" and put your index.html inside it.\n`);
  process.exit(1);
}

let src = fs.readFileSync(SRC, 'utf8');

const ASSET_DIRS = [
  'slide_photos', 'home_photos', 'villa_header_photos',
  'hawksbill_photos', 'jasmine_photos', 'periwinkle_photos', 'rosebay_photos',
];
for (const d of ASSET_DIRS) {
  src = src.split(`'${d}/`).join(`'/${d}/`)
           .split(`"${d}/`).join(`"/${d}/`)
           .split(`'${d}'`).join(`'/${d}'`);
}


function sliceBetween(text, startMarker, endMarker, label) {
  const a = text.indexOf(startMarker);
  if (a === -1) throw new Error(`Build failed: could not find ${label} ("${startMarker}")`);
  const b = text.indexOf(endMarker, a);
  if (b === -1) throw new Error(`Build failed: could not find end of ${label}`);
  return text.slice(a, b);
}

const dataBlock  = sliceBetween(src, 'const IMG={', 'let _interval', 'data block');
const buildBlock = sliceBetween(src, 'function buildHome(){',
                                "document.addEventListener('keydown'", 'build functions');

const sandbox = {};
vm.createContext(sandbox);
try {
  vm.runInContext(
    dataBlock + '\n' + buildBlock +
    '\n;this.__api={buildHome,buildVilla,buildAbout,VD,IMG,MAPS};',
    sandbox
  );
} catch (e) {
  console.error('\nERROR while executing your build functions in Node:\n  ' + e.message +
    '\n\nThis usually means buildHome/buildVilla/buildAbout now reference a\n' +
    'browser-only variable (document, window, ...). Keep those functions pure\n' +
    '— string in, string out — and the build will work.\n');
  process.exit(1);
}
const { buildHome, buildVilla, buildAbout, VD, IMG, MAPS } = sandbox.__api;


const HERO_IMG  = (IMG.hero && IMG.hero[0]) || '/slide_photos/1.jpg';
const ABOUT_IMG = (IMG.stjohn && IMG.stjohn[0]) || HERO_IMG;

function villaTitle(v) {
  return `${v.name} Villa — ${v.tagline} | ${SITE_NAME}, St. John USVI`;
}
function villaDesc(v) {
  const first = v.desc.split('. ')[0].replace(/\s+/g, ' ').trim();
  let d = `${v.name} — ${v.tagline}. ${v.beds} bedroom, ${v.baths} bath villa sleeping up to ${v.guests} on St. John, USVI. ${first}.`;
  return d.length > 158 ? d.slice(0, 155).replace(/[\s,.]+$/, '') + '…' : d;
}
function HOME_TITLE() { return `${SITE_NAME} — Private Villa Rentals on St. John, USVI`; }
function ABOUT_TITLE() { return `About ${SITE_NAME} — Family-Owned Rentals on St. John, USVI`; }
const HOME_DESC  = 'Four family-owned villas on the hills of St. John, USVI — private pools, ocean views, and minutes from Cruz Bay. Hawksbill, Jasmine, Periwinkle & Rosebay.';
const ABOUT_DESC = 'The story behind Las Flores Villas and a short history of St. John in the U.S. Virgin Islands.';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function patch(from, to, label) {
  if (!src.includes(from)) {
    throw new Error(`Build failed: could not apply patch "${label}".\n` +
      `  Expected to find:\n  ${from.split('\n')[0]}\n` +
      `  Did you edit that part of src/index.html?`);
  }
  src = src.replace(from, to);
}


patch(
  `window.go=function(r){window.location.hash=r;window.scrollTo(0,0);closeMobileNav()};`,
  `window.routePath=function(r){return r?'/'+r+'/':'/';};
window.go=function(r){
  const url=window.routePath(r);
  if(location.pathname!==url)history.pushState({route:r},'',url);
  window.scrollTo(0,0);closeMobileNav();render();
};`,
  'router'
);

patch(
  `  const hash=window.location.hash.replace('#','').trim();
  const app=document.getElementById('app');
  app.style.animation='none';
  void app.offsetHeight;
  app.style.animation='';`,
  `  const hash=location.pathname.replace(/^\\/+|\\/+$/g,'').trim();
  const app=document.getElementById('app');
  // First paint: the server already sent this exact markup. Re-writing it
  // would throw away the browser's work and cause a visible flash, so we
  // keep the DOM and only wire up the interactive parts.
  const usePrerendered = _firstRender && window.__PRERENDER__ === hash;
  _firstRender = false;
  if(!usePrerendered){
    app.style.animation='none';
    void app.offsetHeight;
    app.style.animation='';
  }`,
  'render route + prerender guard'
);

patch(`    app.innerHTML=buildHome();`,
      `    if(!usePrerendered)app.innerHTML=buildHome();`, 'home render');
patch(`    app.innerHTML=buildVilla(hash.replace('villa/',''));`,
      `    if(!usePrerendered)app.innerHTML=buildVilla(hash.replace('villa/',''));`, 'villa render');
patch(`    app.innerHTML=buildAbout();`,
      `    if(!usePrerendered)app.innerHTML=buildAbout();`, 'about render');

patch(`let _interval=null, _slide=0;`,
      `let _interval=null, _slide=0, _firstRender=true;`, 'first-render flag');

// --- 3c. Keep title/description/canonical in sync during SPA navigation
const metaTable = Object.entries(VD).map(([id, v]) =>
  `  'villa/${id}':{t:${JSON.stringify(villaTitle(v))},d:${JSON.stringify(villaDesc(v))}}`
).join(',\n');

patch(
  `function navMode(hero){`,
  `const META={
${metaTable},
  'about':{t:${JSON.stringify(ABOUT_TITLE())},d:${JSON.stringify(ABOUT_DESC)}},
  '':{t:${JSON.stringify(HOME_TITLE())},d:${JSON.stringify(HOME_DESC)}}
};
function syncMeta(route){
  const m=META[route]||META[''];
  if(!m)return;
  document.title=m.t;
  const d=document.querySelector('meta[name="description"]');
  if(d)d.setAttribute('content',m.d);
  const c=document.querySelector('link[rel="canonical"]');
  if(c)c.setAttribute('href',${JSON.stringify(SITE_URL)}+window.routePath(route));
}
function navMode(hero){`,
  'meta sync'
);
patch(`function render(){
  clearInterval(_interval);`,
      `function render(){
  clearInterval(_interval);
  syncMeta(location.pathname.replace(/^\\/+|\\/+$/g,'').trim());`, 'syncMeta call');

// --- 3d. popstate (back/forward button)
patch(`window.addEventListener('hashchange',render);`,
      `window.addEventListener('popstate',render);`, 'popstate');

// --- 3e. Links become real, crawlable, right-clickable anchors
for (const route of ['', 'villa/hawksbill', 'villa/jasmine',
                     'villa/periwinkle', 'villa/rosebay', 'about']) {
  const href = route ? `/${route}/` : '/';
  const re = new RegExp(
    `href="#[^"]*"\\s+onclick="go\\('${route.replace(/\//g, '\\/')}'\\)"`, 'g');
  src = src.replace(re, `href="${href}" onclick="go('${route}');return false"`);
}
// footer <li role="link"> -> anchors
src = src.replace(
  /<li tabindex="0" role="link" onclick="go\('villa\/(\w+)'\)">([^<]*)<\/li>/g,
  `<li><a href="/villa/$1/" onclick="go('villa/$1');return false">$2</a></li>`);

const crumbs = trail => ({
  '@type': 'BreadcrumbList',
  itemListElement: trail.map((t, i) => ({
    '@type': 'ListItem', position: i + 1, name: t.name, item: SITE_URL + t.path,
  })),
});
const postalAddress = () => ({
  '@type': 'PostalAddress', streetAddress: ADDRESS.street,
  addressLocality: ADDRESS.locality, addressRegion: ADDRESS.region,
  postalCode: ADDRESS.postal, addressCountry: ADDRESS.country,
});

function ldVilla(id, v) {
  const geo = MAPS[id];
  const hero = (IMG[id] && IMG[id][0]) || HERO_IMG;
  return { '@context': 'https://schema.org', '@graph': [
    { '@type': 'LodgingBusiness', '@id': `${SITE_URL}/villa/${id}/#lodging`,
      name: `${v.name} — ${SITE_NAME}`, description: v.desc,
      url: `${SITE_URL}/villa/${id}/`, image: [SITE_URL + hero],
      address: postalAddress(),
      ...(geo ? { geo: { '@type': 'GeoCoordinates', latitude: geo.lat, longitude: geo.lng } } : {}),
      numberOfRooms: v.beds,
      amenityFeature: v.amen.map(a => ({
        '@type': 'LocationFeatureSpecification', name: a, value: true })),
      containedInPlace: { '@type': 'Place', name: 'St. John, U.S. Virgin Islands' },
      isPartOf: { '@id': `${SITE_URL}/#business` } },
    crumbs([{ name: 'Home', path: '/' }, { name: v.name, path: `/villa/${id}/` }]),
  ]};
}
const ldHome = () => ({ '@context': 'https://schema.org', '@graph': [
  { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, url: SITE_URL + '/',
    name: SITE_NAME, inLanguage: 'en-US' },
  { '@type': 'LodgingBusiness', '@id': `${SITE_URL}/#business`, name: SITE_NAME,
    description: 'Four family-owned vacation villas on the hills above Cruz Bay, St. John, U.S. Virgin Islands.',
    url: SITE_URL + '/', image: [SITE_URL + HERO_IMG],
    address: postalAddress(),
    geo: { '@type': 'GeoCoordinates', latitude: 18.3233479, longitude: -64.7820488 },
    makesOffer: Object.entries(VD).map(([id, v]) => ({ '@type': 'Offer',
      itemOffered: { '@type': 'Accommodation', name: v.name, url: `${SITE_URL}/villa/${id}/` } })) },
]});
const ldAbout = () => ({ '@context': 'https://schema.org', '@graph': [
  { '@type': 'AboutPage', '@id': `${SITE_URL}/about/#page`, url: `${SITE_URL}/about/`,
    name: `About ${SITE_NAME}`, isPartOf: { '@id': `${SITE_URL}/#website` } },
  crumbs([{ name: 'Home', path: '/' }, { name: 'About', path: '/about/' }]),
]});

function buildPage({ route, title, description, image, jsonld, appHTML, noindex }) {
  const canonical = SITE_URL + (route ? `/${route}/` : '/');
  const img = /^https?:/.test(image) ? image : SITE_URL + image;
  let h = src;

  h = h.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  h = h.replace(/<meta name="description" content="[^"]*">/,
                `<meta name="description" content="${esc(description)}">`);
  h = h.replace(/<meta property="og:title" content="[^"]*">/,
                `<meta property="og:title" content="${esc(title)}">`);
  h = h.replace(/<meta property="og:description" content="[^"]*">/,
                `<meta property="og:description" content="${esc(description)}">`);
  h = h.replace(/<meta property="og:image" content="[^"]*">/,
                `<meta property="og:image" content="${esc(img)}">`);

  const head = `<link rel="canonical" href="${canonical}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(img)}">
<meta name="robots" content="${noindex ? 'noindex,follow'
  : 'index,follow,max-image-preview:large,max-snippet:-1'}">
<meta name="geo.region" content="VI">
<meta name="geo.placename" content="St. John, U.S. Virgin Islands">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
`;
  h = h.replace('</head>', head + '</head>');
  h = h.replace('<div id="app"></div>',
    `<script>window.__PRERENDER__=${JSON.stringify(route)};</script>\n<div id="app">${appHTML}</div>`);

  return h;
}

const written = [];
function write(rel, content) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  written.push(rel);
}

write('index.html', buildPage({
  route: '', title: HOME_TITLE(), description: HOME_DESC,
  image: HERO_IMG, jsonld: ldHome(), appHTML: buildHome(),
}));

for (const [id, v] of Object.entries(VD)) {
  write(`villa/${id}/index.html`, buildPage({
    route: `villa/${id}`, title: villaTitle(v), description: villaDesc(v),
    image: (IMG[id] && IMG[id][0]) || HERO_IMG,
    jsonld: ldVilla(id, v), appHTML: buildVilla(id),
  }));
}

write('about/index.html', buildPage({
  route: 'about', title: ABOUT_TITLE(), description: ABOUT_DESC,
  image: ABOUT_IMG, jsonld: ldAbout(), appHTML: buildAbout(),
}));

write('404.html', buildPage({
  route: '', title: `Page Not Found — ${SITE_NAME}`,
  description: 'That page could not be found.',
  image: HERO_IMG, jsonld: ldHome(),
  appHTML: buildHome(), noindex: true,
}));

const today = new Date().toISOString().slice(0, 10);
const urls = [{ loc: '/', pri: '1.0', freq: 'weekly' },
  ...Object.keys(VD).map(id => ({ loc: `/villa/${id}/`, pri: '0.9', freq: 'weekly' })),
  { loc: '/about/', pri: '0.5', freq: 'monthly' }];
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${SITE_URL}${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.freq}</changefreq>
    <priority>${u.pri}</priority>
  </url>`).join('\n')}
</urlset>
`);

write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);

write('.nojekyll', '');

console.log('Built:');
written.forEach(f => {
  const kb = (fs.statSync(path.join(ROOT, f)).size / 1024).toFixed(1);
  console.log(`  ${f}  (${kb} KB)`);
});
console.log(`\nCanonical host: ${SITE_URL}`);
console.log('If that is wrong, edit SITE_URL at the top of build.js and re-run.');
