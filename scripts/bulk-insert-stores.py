"""
Bulk-insert TikTok live store handles into the watchlist.
Usage: python3 scripts/bulk-insert-stores.py
"""
import os
import urllib.request
import urllib.error
import json
import time
import sys

BASE_URL = os.environ.get("VALIDDS_API_URL", "http://localhost:3000")
JWT = os.environ.get("VALIDDS_JWT") or os.environ.get("JWT")
if not JWT:
    sys.exit("Set VALIDDS_JWT (or JWT) to an admin bearer token before running.")

# ── Handles ────────────────────────────────────────────────────────────────────
HANDLES = [
    # Beauty / Makeup / Skincare
    "canvasbeautybrand", "iamstormisteele", "simplymandys", "mikaylanogueira",
    "monetmcmichael", "angelamachadobeauty", "hyram", "abbyroberts",
    "krystalkbeauty", "luisalejandrobeauty", "allieglines", "emmycombss",
    "meredithduxbury", "rocio.roses", "lexwolff", "yayayayoung",
    "carlosskincare", "baskandlather", "alixearle", "snitchery",
    "juliamarrero6", "simply_mari_ky", "martha.aviles", "elizabethsinai13",
    "elfcosmetics", "cerave", "tartecosmetics", "naturium", "skin1004",
    "anua", "laurageller", "medicube", "phlur", "ultabeauty", "sallybeauty",
    "fentylbeauty", "charlotteparler", "thrivecausemetics", "beautybyrosangela",
    "makeupbyariel", "nikkitutorials", "glamzilla", "hindash",
    "patrickstarrr", "monet_mcmichael", "jlovemac", "wakeupandmakeup",
    "lisasafarah", "makeupbymario", "dressyourface", "thebeautytemple",
    "lisaeldridge", "charlotte.tilbury", "farahanegm", "powermizzou",
    "glam_anne", "beautymakeupstan", "msyummymakeup", "xomiranda",
    "cassandrabankson", "beautybyfinesse", "makeupartistlasvegas",
    "janetanase", "jadeywadey180", "lalaleluu", "melanin.queen.jess",
    "kylieskin", "rhode", "skims.beauty", "glossier.official",
    "tatcha.official", "drbarbarasturm", "paulaschoice", "theordinary",
    "innisfree_us", "etudehouse_official", "skincarebyalana",
    "cleanbeautyguru", "skincaretok", "actingofficially",

    # Fashion / Clothing
    "gymshark", "shein", "fashionnova", "prettylittlething",
    "wisdm8", "pinuppixie", "the.navarose", "brittany.xavier",
    "secondhandhuns", "remibader", "ttaanyaa", "ann.le.do",
    "audaamar", "beingcrystalnicolee", "milan.mathew", "sarahbaghdedi",
    "monikkamancini", "tinyjewishgirl", "janiceglimmer", "katrinavmakeup",
    "bretmanrock", "shopluminous", "zaful_official", "romwe_official",
    "ciderclothing", "aritzia", "revolve", "urbanoutfitters",
    "freepeople", "hollisterco", "americaneagle", "forever21",
    "zara", "h.and.m", "abercrombieandfitch", "express_official",
    "lulus", "showpo", "nastygal", "misguided",
    "boohoo_official", "missguided", "clothinghauls", "thriftflip",
    "vintagefinds", "depop", "poshmark.official", "thredup",
    "styledbysavs", "chloeting", "fashionbyjasmin", "styledbynina",
    "outfitinspo.daily", "ootdmagazine", "thefashionfix",
    "stylishpetite", "lynnstyle", "thestylestalker",
    "fashionphile", "therealreal", "vestiairecollective",
    "rebag_official", "fashionnovacurve", "eloquii",

    # Home Decor / Kitchen / Organization
    "homewithfarah", "emilyrayna", "teresalauracaruso", "galeyalix",
    "caranewhart", "peonyandhoney", "everyday_homedecor",
    "absholidaydecor", "meiralaryssa", "im_ericwang", "miya0867",
    "_catben_", "homesbyamberinteriors", "organizedbyshira",
    "mrshineyliving", "cleanwithmearanda", "professionalhomeorganizer",
    "homemadebycarli", "theorganisedmum", "tidyingwiththelauras",
    "thehomeedit", "conmarimethod", "simplifiedliving",
    "homesensestores", "crateandbarrel", "westelm", "potterybarn",
    "ikea_usa", "target", "walmart", "wayfair",
    "homegoods", "marshalls", "tjmaxx", "worldmarket",
    "bedbathandbeyond", "kirklands", "michealsarts",
    "amazon.finds", "amazonfaves", "amazonhome.finds",
    "primark_us", "miniso_usa", "five.below",
    "cleaningmotivation", "cleanwithme", "homecleantips",
    "laundrytips.tiktok", "organizationhacks",

    # Food / Cooking / Snacks
    "cookingwithlynja", "albert_cancook", "tommywinkler",
    "chefboybonez", "cozyivn", "karissaeats", "cookingwithshereen",
    "cookinginthemidwest", "feelgoodfoodie", "kittyfoodie",
    "adventurous_anders", "eatwithdami", "amyjovel",
    "maxthemeatguy", "gordonramsayofficial", "jackstacks.eats",
    "cucinaconruben", "tabithbrown", "sameats",
    "snacksbydefault", "hotcheetogirl", "tryingsnacks",
    "snacksoftheworld", "internationalsnacks", "bundtcakery",
    "tastytreats.official", "munchiessnacks", "snacktime.official",
    "popchips", "takis_official", "doritos", "lays_official",
    "oreo", "hersheys", "reeses_official", "kinder_official",
    "thinkthin", "rxbar", "kindsnacks", "larabars",
    "missionfoods", "oldelpaso", "goyafoods",
    "cholula_hotsauce", "tabasco_official", "frankshot",
    "grubhub", "doordash", "ubereats", "seamless",
    "hungryroot", "hellofresh", "everyplate", "factor_meals",
    "trifectanutrition", "freshly_official",

    # Fitness / Health / Supplements
    "therock", "senada.greca", "jenselter", "doosifit",
    "demibagby", "bdccarpenter", "shamzies",
    "lindsayrosewellness", "movementbydavid", "jessejameswest",
    "gymreapers", "alphalete", "gymshark", "nobullproject",
    "lululemon", "alorobe", "vuoriclothing", "alo_yoga",
    "nikewomen", "nikesportswear", "underarmour", "adidas",
    "newbalance", "asicsamerica", "brooksrunning",
    "optimumnutrition", "gnc_official", "bodybuilding.com",
    "musclepharm", "cellucor", "transparentlabs",
    "gainful_official", "ritual_vitamins", "athleticgreens",
    "ag1official", "bloom.nutrition", "nudestix",
    "drinkelements", "liquidiv", "nuunhydration",
    "drinkbodied", "biotics8", "performancenutrition",
    "crossfit", "peloton", "mirrorworkout", "hydrow",
    "tonal_official", "bowflex", "nordictrack",

    # Tech / Gadgets / Electronics
    "ankerofficial", "sharkninja", "samsung", "appleofficial",
    "lgusa", "sonyelectronics", "jbl_audio", "beats",
    "bose_official", "sonos_official", "klipsch",
    "jackery_official", "ecoflow_official", "goalzero",
    "dji_official", "gopro", "insta360_official",
    "ring_official", "arlo", "wyze_official",
    "roomba_irobot", "ecovacs_official", "roborock_official",
    "dysonofficial", "sharkclean", "bissel_official",
    "instantpot", "ninjacooking", "kitchenaid", "vitamix",
    "keurig", "nespresso_official", "breville",
    "apple.deals", "techdeals.official", "gadgetfinder",
    "unboxingtech", "techreviewer", "techwithbrendan",
    "mrwhosetheboss", "mkbhd", "linus_tech",

    # Pet Products
    "thatlittlepuff", "manny_the_frenchie", "ivartheblindcat",
    "petco", "petsmart", "chewy_official",
    "barkbox_official", "kong_official", "zutadog",
    "olliedog", "farmersdog", "nomnomdog",
    "freshpet", "wildearth_official", "sundays.for.dogs",
    "tuxedocat.official", "catperson_official", "smalls.for.cats",
    "weruva_official", "rawznaturalpetfood", "openfarmpetfood",
    "zymox_official", "vetericyn", "pawsafe",

    # Baby / Kids
    "babyletto", "uppa.baby", "chiccousa",
    "momcozy_official", "haakaa", "lansinoh",
    "boppy_official", "ergobaby", "sollybabyusa",
    "lovevery_official", "mellotoy", "magiclinks",
    "kokimakids", "jellycat", "melissa.and.doug",
    "lego", "barbie", "hotwheel",
    "crayola", "Elmer.glue", "kidkraft",

    # Jewelry / Accessories
    "mejuri", "gorjana", "aurate.jewelry",
    "pandora_jewelry", "kendra_scott", "alexandani",
    "uncommongoods", "ringconcierge", "catbirdnyc",
    "initials.inc", "bevboutique", "baublebars",
    "wanderlustaneco", "shophearts", "shopgoldies",
    "aloyoga.accessories", "free.people.accessories",
    "stelladot", "paigelayla", "shinestonejewelry",
    "tiffanyandco", "davidyurman_official", "swarovski",

    # Candles / Fragrance / Wellness
    "yankeecandle", "bathbodyworks", "trulybeauty",
    "luxluminara", "paddywax", "voluspa_official",
    "capri_blue", "woodwickcandles", "malinandgoetz",
    "byredo_official", "diptyque_official", "jo.malone",
    "leliabo_official", "maison.margiela", "kayali_official",
    "juicycouture_fragrance", "victoriassecret", "scentbird",
    "scentbox_official", "perfumepitch",

    # Sports / Outdoors
    "rei_official", "patagonia", "thenorthface",
    "arcteryx", "columbia_sportswear", "salomon",
    "yeti_official", "hydro.flask", "stanleybrand",
    "simplemodernbrand", "owalalife", "camelbackwater",
    "traeger_grills", "webergrills", "charbroilgrills",
    "camping.world", "decathlon_official", "dickssportinggoods",
    "callawaygolf", "titleist_official", "taylormadesports",
    "wilsonsports", "callaway", "penneliteproducts",

    # Hair Care
    "mielleorganics", "olaplex", "naturalhairqueen",
    "curlsmith_official", "devacurl", "carols.daughter",
    "shedavi", "sisterslocks", "tresemme",
    "pantene", "herbal.essences", "garnier.official",
    "wella_professional", "revlon_official", "ionbeauty",
    "ghd_hair", "dysonhair", "t3micro",
    "beachwaver", "babyliss.pro", "vs.sassoon",

    # Cleaning / Household
    "mrclean", "swiffer", "pinesol_official",
    "dawn.dish", "tide_official", "arm_hammer",
    "method_products", "seventh_generation", "caldrea",
    "mrs.meyers", "grove.collaborative", "blueland",
    "dropps_official", "molly.suds", "dirtylabs",
    "branchhome", "humble_suds",

    # Books / Education / Stationery
    "penguinrandom.house", "barnesandnoble", "thriftbooks",
    "bookofthemonth", "literati.bookclub",
    "rhodiapaper", "leuchtturm1917", "papermateofficial",
    "postalco_official", "fieldnotes", "apica_japan",
    "staedtler_official", "tombow_official", "pentelarts",
    "crayola.art", "primamarketing", "artistloft",

    # General Popular Live Sellers / Affiliates
    "qvc", "hsn_official", "shopnbc",
    "liveshopping.daily", "dealmoon_official",
    "dealnews", "slickdeals",
    "amazondaily.deals", "tiktokshopdeal",
    "thedealhunter", "couponingwithrachel",
    "savingwithsharon", "budgetfinds", "bargainhunter",
    "pricedrop.alert", "dealhunters.official",

    # More popular creators known to go live
    "addisonre", "charlidamelio", "dixiedamelio",
    "jlo", "kimkardashian", "khloekardashian",
    "kourtneykardashian", "jennerkylie",
    "selenagomez", "arianagrande_", "beyonce",
    "taylorswift", "rihannaofficial",
    "justinbieber", "drake", "nickiminaj",
    "cardi.b", "lilnasx", "dualipa",
    "billieeilish", "harrystyles",

    # Additional US TikTok Shop Live Sellers
    "shopsimplelife", "shopwithme.official", "liveshoppingus",
    "dealmehappy", "findsforyou", "amazingdeals.official",
    "shoppingwithsteph", "shopaholicsteph", "buythis.notthat",
    "findsonline", "shopmyjoy", "shopwithkarma",
    "tiktokshopfinds", "bestbuysonline", "flashdeal.official",
    "trendingproducts.us", "mustbuythis", "buyornot.official",
    "onlineshopping.tips", "dealsoftheday.us",
    "shopwithashley", "shopwithkayla", "shopwithbri",
    "shopwithbella", "shopwithemily", "shopwithjess",
    "shopwithkaty", "shopwithlaura", "shopwithmia",
    "shopwithrachel", "shopwithsarah", "shopwithzoe",
    "liveshopping.queen", "liveshopwithme",
    "gettingitforyou", "productfinder.us",
    "tiktokmademebuyit", "tiktokfinds",
    "founditonline", "foundontiktok",
    "trendingontiktok", "viralproducts",
    "amazonfound", "amazonfinds.viral",
    "amazonmustbuys", "amazondeals.live",
]

# De-duplicate
HANDLES = list(dict.fromkeys(h.strip().lower().replace("@", "") for h in HANDLES if h.strip()))

def add_store(handle: str) -> str:
    url = f"{BASE_URL}/api/v1/tiktok/live/watchlist"
    payload = json.dumps({"handle": handle}).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {JWT}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            status = resp.status
            return "added" if status == 201 else "exists"
    except urllib.error.HTTPError as e:
        return f"err-{e.code}"
    except Exception as ex:
        return f"err-{type(ex).__name__}"

def main():
    total   = len(HANDLES)
    added   = 0
    exists  = 0
    errors  = 0

    print(f"Inserting {total} handles...\n")

    for i, handle in enumerate(HANDLES, 1):
        result = add_store(handle)
        if result == "added":
            added += 1
            status = "✓"
        elif result == "exists":
            exists += 1
            status = "~"
        else:
            errors += 1
            status = f"✗ ({result})"

        print(f"[{i:>4}/{total}] @{handle:<40} {status}")
        # Small delay to avoid hammering the server
        time.sleep(0.15)

    print(f"\n── Results ──────────────────────────")
    print(f"  Added:   {added}")
    print(f"  Already: {exists}")
    print(f"  Errors:  {errors}")
    print(f"  Total:   {total}")

if __name__ == "__main__":
    main()
