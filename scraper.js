const http = require("http");
const https = require("https");
const cheerio = require("cheerio");
const Knwl = require("knwl.js");

function getDomainFromEmail(email) {
	return email.split("@")[1];
}

function fetchWebsite(url, callback, redirectCount = 0) {
	if (redirectCount > 5) return callback(new Error("Too many redirects"), null);

  	const client = url.startsWith("https") ? https : http;
  	console.log(`Fetching: ${url}`);

  	const req = client.get(url, (res) => {
    		let data = "";

    		// Page Redirect
    		if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      			const newUrl = res.headers.location.startsWith("http")
			? res.headers.location
        		: new URL(res.headers.location, url).href;

      			console.log(`Redirected to: ${newUrl}`);
      			req.destroy(); 
      			return fetchWebsite(newUrl, callback, redirectCount + 1);
    		}

    		// Success
    		if (res.statusCode >= 200 && res.statusCode < 300) {
      			res.on("data", (chunk) => (data += chunk));
      			res.on("end", () => callback(null, data));
    		} else {
      			callback(new Error(`HTTP ${res.statusCode} from ${url}`), null);
    		}
  	});

  	// Timeout
  	req.setTimeout(5000, () => {
    		req.destroy();
    		callback(new Error(`Timeout when fetching ${url}`), null);
  	});

  	req.on("error", (err) => callback(err, null));
}

function scrapeInfo(html) {
	const $ = cheerio.load(html);
 	const knwl = new Knwl("english");
  	knwl.init(html);

  	var title = $('meta[property="og:site_name"]').attr('content');
	if (!title || title.trim() === "") {
    		title = $('meta[name="application-name"]').attr('content');
    
    		if (!title || title.trim() === "") {
        		title = $("title").text().trim();
    		}
	}


  	var emails = knwl.get("emails").map((e) => e.address);
	$('a[href^="mailto:"]').each((i, el) => {
  		const email = $(el).attr('href').replace('mailto:', '').trim();
 	 	emails.push(email);
	});

	emails = emails.filter(email => !/sentry\.io/i.test(email) && !/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(email));


  	var phones = knwl.get("phones").map((p) => p.phone);
  	$('a[href^="tel:"]').each((i, el) => {
  		const num = $(el).attr('href').replace('tel:', '').trim();
  		phones.push(num);
	});

  	// const addresses = knwl.get("places").map((p) => p.place);

	var addresses = [];
	$('p, a, span, address, h1, h2, h3, h4, h5, h6').each((i, el) => {
  		const text = $(el).text().trim();
		$('style, script').remove();

		if (text.length > 100) return;
		if (/\£|\$/.test(text)) return;
		if (/\b\d{1,4}-\d{1,4}\b/.test(text)) return;

  		// Check for Street
  		if (/\d+/.test(text) && /\b(Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Estate)\b/i.test(text)) {
			if (/\d+/.test(text)) {
   	 			addresses.push(text);
			}
  		}

  		// Check UK Postcode
  		if (/\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/i.test(text)) {
    			addresses.push(text);
  		}

  		// Check US ZIP Code
  		// if (/\b\d{5}(?:-\d{4})?\b/.test(text)) {
    		//	addresses.push(text);
  		// }
	});
	
	// Check industries
	const metatags = ($('meta[name="keywords"]').attr('content') || $('meta[name="Keywords"]').attr('content') || '').toLowerCase().split(',').map(k => k.trim()).filter(k => k.length);
	var industries = (industriesList.filter(industry => metatags.includes(industry)));
	const descriptionText = ($('meta[name="description"]').attr('content') || $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '').toLowerCase();
	industries = industries.concat(industriesList.filter(industry => descriptionText.includes(industry)));

	// Remove duplicates
	addresses = [...new Set(addresses)];
	industries = [...new Set(industries)];
	phones = [...new Set(phones)];
	emails = [...new Set(emails)];	

  	return { domain, title, emails, phones, addresses, industries };
}

const visitedUrls = new Set();

function fetchWeb(url, callback) {
	if (visitedUrls.has(url)) return callback(null, {emails: [], phones: [], addresses: []});
  	visitedUrls.add(url);

  	fetchWebsite(url, (err, html) => {
    		if (err) return callback(err);

    		let data = scrapeInfo(html);

    		// Find contact links
    		const $ = cheerio.load(html);
    		var pagelinks = [];
    		$('a[href]').each((i, el) => {
      			const href = $(el).attr('href');

			if (href.startsWith('mailto:')) return;

      			if (href.includes(domain)) {
        			const absoluteUrl = href.startsWith('http') ? href : new URL(href, url).href;
        			if (!visitedUrls.has(absoluteUrl)) pagelinks.push(absoluteUrl);
      			}
    		});
		
		pagelinks = [...new Set(pagelinks)].slice(0, 100 - visitedUrls.size);

 		if (pagelinks.length === 0) return callback(null, data);

    		// Fetch contact pages
    		let pending = pagelinks.length;
    		pagelinks.forEach(link => {
      			fetchWebsite(link, (err2, pageHtml) => {
        			if (!err2) {
          				const pageData = scrapeInfo(pageHtml);
          				data.emails = [...new Set([...data.emails, ...pageData.emails])];
          				data.phones = [...new Set([...data.phones, ...pageData.phones])];
          				data.addresses = [...new Set([...data.addresses, ...pageData.addresses])];
					data.industries = [...new Set([...data.industries, ...pageData.industries])];
        			}
        			pending--;
        			if (pending === 0) callback(null, data);
      			});
    		});
  	});
}


// Main runner
const email = process.argv[2];
if (!email) {
  	console.error("Usage: node scraper.js example@domain.com");
  	process.exit(1);
}

const domain = getDomainFromEmail(email);
const startUrls = [
  `https://www.${domain}`,
  `https://${domain}`,
  `http://${domain}`,
  `http://www.${domain}`
];

// Industry list
const industriesList = [ "joinery", "steelfix", "construction", "interiors", "hospitality", "healthcare", "education", "retail", "store", "leisure", "manufacturing", "technology", "finance", "logistics", "automotive", "energy", "media", "software","agriculture", "farming", "forestry", "fishing", "mining", "gas", "oil", "chemical", "pharmaceutical", "biotechnology", "telecommunication", "aerospace", "defense", "fashion", "textile", "footwear", "jewellery", "cosmetic", "beverage", "restaurant", "catering", "tourism", "travel", "airline", "railway", "shipping","maritime", "real estate", "property management", "architecture", "Public Relations", "consulting", "marketing", "advertising", "Events", "management", "sports", "fitness", "wellness", "insurance", "banking", "capital", "equity","investment", "legal", "accounting", "auditing", "tax advisory", "recycling", "waste management", "water management", "environment", "research", "art", "entertainment", "gaming", "film", "music", "broadcasting", "publishing","commerce", "apparel", "home goods", "furniture", "gardening", "pets", "hobbies", "non-profit", "charity", "government", "defence contracting", "security", "cybersecurity", "data", "computing", " ai", "blockchain", "cryptocurrency", "nanotechnology", "robotic", "energy", "virtual reality", "augmented reality", "service", "mobility", "transport", "renewable", "solar", "wind", "hydroelectric", "geothermal", "nuclear", "petroleum", "metal", "packaging", "printing", "logistics", "supply", "electronics",  "internet", "tech", "nanomaterial", "plastic", "ceramic", "textile", "leather", "museum", "library", "libraries", "education", "training", "career", "recruitment", "staffing", "furnishing", "furniture", "game", "gaming", "design", "craftsmanship", "animation", "tv", "television", "streaming", "videos", "shoes", "trainers", "sneakers", "farming", "chocolate", "desert", "cafe", "café", "interior design", "exterior design", "carpentry", "chips", "crisps", "yogurt", "alcohol", "beer", "pub", "meat", "chicken", "butcher", "fishmonger", "cheese", "worship", "community", "social media", "football", "rugby", "youth", "senior", "carer", "acting", "b2b", "sales", "applications", "network", "domain", "hosting", "speaker", "programming", "web development", "tutorials", "code", "quiz", "learn", "lesson", "graphics", "how to", "shopping", "tours", "hotel", "discount", "nintendo", "xbox", "ps4", "ps5", "switch", "steam", "gift", "candy", "sweet", "food", "luxury", "watch", "theatre", "show", "hobby", "money", "finance", "financial", "investment", "gambling", "casino", "holiday", "skiing", "boating"];


function tryNext(i) {
 	if (i >= startUrls.length) {
	    	console.error("No valid site found");
    		return;
  	}
  	fetchWeb(startUrls[i], (err, data) => {
    		if (err) {
      			console.log(`${err.message}, trying next...`);
      			tryNext(i + 1);
    		} else {
      			console.log("Extracted Info:");
      			console.log(data);
    		}
  	});
}

console.log(`Scraping data for domain: ${domain}...`);
tryNext(0);
