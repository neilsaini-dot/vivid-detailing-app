"""Export owner-approved selection-screen prices as bot knowledge."""
import json
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED

services = json.loads(Path("/tmp/vivid-services.json").read_text())
addons = json.loads(Path("/tmp/vivid-addons.json").read_text())
vehicles = ["car", "suv", "truck", "van"]

def amount(n):
    return "Custom quote required" if n is None else f"${n:,.2f}"

def price(s, vehicle):
    if s.get("pricingRule") == "quote_based":
        return None
    return next((x["price"] for x in s["prices"] if x["vehicleType"] == vehicle), s.get("basePrice"))

def price_line(item):
    return "; ".join(f"{v.upper() if v == 'suv' else v.title()}: {amount(price(item, v))}" for v in vehicles)

blocks = []
def h(text):
    blocks.append(("heading", text))
def p(text):
    blocks.append(("paragraph", text))
def bullet(text):
    blocks.append(("bullet", text))

h("Vivid Detailing — Conversation Bot Knowledge")
p("Pricing, packages, add-ons, tint choices, and quoting guidance")
p("Catalog snapshot date: October 3, 2026. Source: the app's active public catalog and selection-screen amounts, plus its booking and quote screens. The owner has confirmed that selection-screen amounts are the correct prices. This is not a verified snapshot of the published site's database. Dollar amounts use the app's $ notation; confirm the currency with the owner before explicitly labeling it CAD.")

h("1. Bot instructions and pricing safety")
bullet("Ask for the vehicle type first: car, SUV, truck, or van. Ask for the year, make, model, desired service, and relevant condition concerns.")
bullet("All catalog prices below are before 15% HST unless a total is explicitly labeled tax-inclusive. Distinguish the base service from optional paid add-ons.")
bullet("Use the selection-screen prices listed in this document as the owner-approved prices. Quote the exact amount for the customer's vehicle type. Do not replace these prices with calculator-derived amounts, apply vehicle multipliers, or round package prices up to $5.")
bullet("For Paint Correction and PPF, offer a custom quote. Missing or pending prices are not free. Do not present a subtotal for known items as the complete price when a quote-based item is included.")
bullet("Do not invent discounts, guarantees, extra coverage, deposit requirements, cancellation fees, or payment policies. Do not promise appointment availability or a pickup time without checking the current booking system or staff.")
bullet("Use only the current active catalog. Refresh this document when the owner changes prices, package inclusions, offers, or availability. Verify against production before using it for a live customer bot.")
bullet("Listed coating durability and tint warranty statements are catalog claims. Do not add warranty terms, damage guarantees, or maintenance promises that are not listed.")

h("2. Pricing rules")
p("Look up the exact vehicle-specific service price in Section 3. These are the amounts shown on the selection screen and confirmed by the owner. Do not derive prices from a base-price multiplier or round them up. For example, Vivid Ceramic Gloss Pro for a car is $299 before HST, not $300.")
p("Add-ons use their exact vehicle-specific prices in Section 4. Do not apply vehicle multipliers to add-ons. Paint Correction and PPF require a custom quote.")
p("Calculation: subtotal = listed services + listed add-ons. Subtract an eligible booking-time bundle discount before tax. HST = 15% of the discounted subtotal. Round tax and totals to cents. Quote-only items still need a separate confirmed amount.")

h("3. Service catalog")
times = {
    "Vivid Interior": "4–6 hours", "Vivid Luster": "5–6 hours",
    "Vivid Glow": "6–7 hours", "Summer Special Ceramic Exterior": "7 hours",
    "Vivid Ceramic Gloss Pro": "7 hours", "Vivid Ceramic Guard": "24 hours",
    "Vivid Ceramic Elite Guard": "36 hours", "Vivid Ceramic Tint - Rear": "6 hours",
    "Vivid Ceramic Tint - Full": "8 hours", "Windshield Eyebrow Tint": "2 hours",
    "Paint Correction": "4–24 hours", "PPF - Full Front": "Custom",
}
for s in services:
    h(s["name"])
    p("Category: " + s["category"].replace("_", " ").title())
    p(s["description"] or "No description configured.")
    p("Included: " + "; ".join(s["includes"]))
    if s["pricingRule"] == "quote_based":
        p("Pricing status: CUSTOM QUOTE REQUIRED. No fixed price is configured.")
    else:
        p("Owner-approved selection-screen prices before HST: " + price_line(s))
    if s["isSeasonal"]:
        p("Seasonal offer: active in this development snapshot. No validity dates are provided here; confirm current availability before promising it.")
    p("Base car service-time estimate in the app: " + times[s["name"]] + ". Not a guaranteed turnaround or pickup time.")
    if s["name"] == "Vivid Ceramic Guard":
        p("Coverage clarification required: the description mentions glass, but the inclusion list specifies paint + trim only. Confirm glass coverage with staff; do not promise it as included.")
    if s["name"] == "Vivid Ceramic Tint - Full":
        p("Full tint covers all side windows and the rear windshield. Full front-windshield tint is not listed as included.")

h("4. Add-on catalog")
p("All prices below are regular add-on prices before HST. Add-ons are optional. Names alone do not establish extra scope, guaranteed results, or quantity definitions.")
addon_time = {"Pet Hair Removal": "1–2", "Steam Cleaning Interior": "1",
    "Shampoo Upholstery": "3", "Headliner Cleaning": "1",
    "Ozone Treatment / Deodorizer": "2", "Child Seat Clean & Sanitize": "1",
    "Additional Mats": "1", "Vivid Interior Ceramic Leather": "2",
    "Headlight Restoration": "2", "Engine Shampoo": "1", "Ceramic Rims": "1",
    "Paint Decontamination": "1", "Paint Sealant": "1",
    "Minor Scratch/Blemish Correction": "1", "Windshield Hydrophobic Coating": "1",
    "Soft Top / Tonneau Cover Protection": "1",
    "Vivid Ceramic Glass - Full Vehicle": "2", "Windshield Ceramic": "1"}
for group in dict.fromkeys(a["categoryGroup"] for a in addons):
    h(group)
    for a in [a for a in addons if a["categoryGroup"] == group]:
        bullet(a["name"] + " — " + price_line(a) + ". Added time estimate: " + addon_time[a["name"]] + " hour(s).")
p("The protection-selection step additionally offers Vivid Interior Ceramic Leather, Vivid Ceramic Glass - Full Vehicle, and Windshield Ceramic.")
p("Windshield Hydrophobic Coating ($120/$140/$160/$160) and Windshield Ceramic ($89 for every vehicle type) are separate catalog entries. Do not treat them as the same product or substitute one price for the other.")
p("Do not automatically charge for an add-on already covered by a package. Clarify intended extra scope with staff, especially shampoo, decontamination, and glass treatments.")

h("5. Booking-time bundle offer")
p("The app offers 25% off selected recommended add-ons when added through the Exclusive Bundle Offer step at booking time. This is not 25% off the whole booking, and it does not automatically apply to every add-on selected earlier. Each eligible add-on's savings is rounded to cents before summing; HST is applied after the discount.")
recommendations = {
    "Vivid Interior": ["Ozone Treatment / Deodorizer"],
    "Vivid Luster": ["Paint Sealant", "Windshield Hydrophobic Coating"],
    "Vivid Glow": ["Vivid Ceramic Glass - Full Vehicle"],
    "Summer Special Ceramic Exterior": ["Windshield Ceramic", "Ceramic Rims"],
    "Vivid Ceramic Gloss Pro": ["Windshield Ceramic", "Ceramic Rims"],
    "Vivid Ceramic Guard": ["Vivid Ceramic Glass - Full Vehicle", "Vivid Interior Ceramic Leather", "Ceramic Rims"],
    "Vivid Ceramic Elite Guard": ["Vivid Ceramic Glass - Full Vehicle", "Vivid Interior Ceramic Leather", "Ceramic Rims"],
    "Vivid Ceramic Tint - Full": ["Windshield Eyebrow Tint", "Vivid Ceramic Glass - Full Vehicle"],
}
for service, names in recommendations.items():
    bullet(service + ": " + "; ".join(names))
p("No package-specific recommendations are configured for Rear Tint, Eyebrow Tint, Paint Correction, or PPF alone. With multiple services selected, the offer uses the union of their recommended add-ons. Confirm that a specific add-on is offered and selected through the bundle step before promising its discount.")
p("Example: Full Tint $350 + eligible Eyebrow Tint $50. Eyebrow discount = $12.50. Discounted subtotal = $387.50; HST = $58.13; total = $445.63. Without the eligible bundle discount, the same two items total $460.00 including HST.")

h("6. Tint darkness options")
p("VLT means visible light transmission. Lower percentages are darker. The app offers 5%, 15%, 25%, 35%, and 50%; the default selection is 35%. No separate shade surcharge is configured in the pricing logic.")
for text in [
    "5% — Limo: maximum privacy, excellent heat rejection; hardest to see out of at night.",
    "15% — Very Dark: high privacy; described by the app as matching most factory rear window tints; strong glare reduction.",
    "25% — Dark: popular side-window choice with strong privacy and heat rejection.",
    "35% — Medium: balance of privacy and visibility; popular all-around choice.",
    "50% — Light: visible interior and better nighttime visibility; still described as providing UV and heat protection.",
]:
    bullet(text)
p("The preview is illustrative, not a measurement of actual film performance. Do not guarantee a legal tint percentage or recommend illegal installations. Confirm applicable local rules and which windows may be tinted with staff. No independently verified legal limits or numerical UV/heat-rejection specifications are provided in this document.")

h("7. Condition, safety, and time notes")
for text in [
    "Shampoo Upholstery: the app says it is only needed for heavy staining and the vehicle must be left overnight.",
    "Ozone Treatment / Deodorizer: the vehicle must air out for 2–3 hours after treatment before it can be occupied or driven.",
    "Engine Shampoo: the engine must be fully cool before service begins; hood access is required.",
    "Headlight Restoration: results may vary on severely cracked, pitted, or deeply scratched lenses.",
    "Minor Scratch/Blemish Correction: suitable for light surface scratches only; deep chips, gouges, or panel damage cannot be fully corrected.",
    "Pet Hair Removal: heavily embedded hair may require extra time; the final result depends on buildup severity.",
]:
    bullet(text)
p("Service-time estimates add 1 hour per base service for an SUV or truck, and 2 hours per base service for a van. Add-on times are added separately. If PPF is selected, the app displays a custom time estimate. These are app estimates, not confirmed work hours, appointment availability, or completion guarantees. Ask staff about multi-day services and actual pickup timing.")

h("8. Custom-quote options and handoff")
p("The separate quote form offers Paint Correction / Polishing, Paint Protection Film (PPF), Advanced Ceramic Coating, Full Restoration, and Other / Not Sure. These form categories do not establish additional fixed-price packages.")
p("For a quote, collect the customer's name, email and phone; vehicle type, year, make, and model; desired service; current condition and goals; and useful photos. Refer the request to staff. Do not claim a request has been submitted, an appointment booked, or a price approved unless the bot actually completed that action.")
p("A quote-based item can appear as TBD while the app totals known-priced items. Explain that the displayed estimate excludes unpriced work and is not the complete final price.")

h("9. Example bot responses")
p('Customer: “How much is full tint?” Bot: “Full ceramic tint is $350 before 15% HST, or $402.50 including HST. It covers all side windows and the rear windshield; full front-windshield tint is not listed as included. The available darkness options are 5%, 15%, 25%, 35%, and 50%. Staff can confirm which options are appropriate and legal for your windows.”')
interior = next(s for s in services if s["name"] == "Vivid Interior")
interior_suv = price(interior, "suv")
p(f'Customer: “What does an interior detail cost for my SUV?” Bot: “Vivid Interior for an SUV is {amount(interior_suv)} before 15% HST, or {amount(round(interior_suv * 1.15, 2))} including HST. It includes seat extraction and shampoo, carpet shampoo, leather conditioning, vent cleaning, and glass cleaning. Optional add-ons cost extra. What year, make, and model is your SUV?”')
p('Customer: “How much is PPF?” Bot: “PPF is custom quoted. The listed Full Front option covers the hood, fenders, front bumper, side mirrors, and A-pillars with self-healing film. What vehicle do you have, and can you share the coverage you want and photos for the team to review?”')
p('Customer: “Can I get 25% off everything?” Bot: “The booking offer is 25% off eligible recommended add-ons added through the bundle step, not the whole booking. Tell me your package and the add-ons you’re considering so we can check eligibility.”')

h("10. Maintaining this knowledge")
p("The owner has confirmed the selection-screen amounts as the correct service prices. Refresh this document whenever those amounts or add-on prices change. Confirm current seasonal-offer availability and unresolved package-coverage details with staff. No app code or business data was changed to produce this document.")

out = Path("exports/bot-training")
out.mkdir(parents=True, exist_ok=True)
text = "\n\n".join(("• " if kind == "bullet" else "") + value for kind, value in blocks) + "\n"
(out / "vivid-detailing-bot-knowledge.txt").write_text(text)

paragraphs = []
for kind, value in blocks:
    style = "Heading1" if kind == "heading" else "Normal"
    value = ("• " if kind == "bullet" else "") + value
    paragraphs.append(f'<w:p><w:pPr><w:pStyle w:val="{style}"/></w:pPr><w:r><w:t xml:space="preserve">{escape(value)}</w:t></w:r></w:p>')
document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + \
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + \
    "".join(paragraphs) + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>'
styles = '''<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="140"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="260" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="176B87"/><w:sz w:val="28"/></w:rPr></w:style>
</w:styles>'''
with ZipFile(out / "vivid-detailing-bot-knowledge.docx", "w", ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", '''<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>''')
    z.writestr("_rels/.rels", '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>''')
    z.writestr("word/_rels/document.xml.rels", '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>''')
    z.writestr("word/document.xml", document)
    z.writestr("word/styles.xml", styles)
assert len(services) == 12 and len(addons) == 18
assert "OWNER CONFIRMATION REQUIRED" not in text
assert "Calculator:" not in text
assert "vehicle factor" not in text
for s in services + addons:
    assert s["name"] in text
from xml.etree import ElementTree
with ZipFile(out / "vivid-detailing-bot-knowledge.docx") as z:
    assert z.testzip() is None
    for name in z.namelist():
        ElementTree.fromstring(z.read(name))
print(f"Created and validated Word and text documents: {len(services)} services, {len(addons)} add-ons. All amounts use owner-approved selection-screen prices for all four vehicle types.")