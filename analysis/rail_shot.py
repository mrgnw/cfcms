# /// script
# requires-python = ">=3.12"
# dependencies = ["playwright"]
# ///
from playwright.sync_api import sync_playwright

URL = 'http://localhost:5273/'
OUT = '/tmp/rail.png'

with sync_playwright() as p:
	browser = p.chromium.launch()
	ctx = browser.new_context(viewport={'width': 1100, 'height': 700}, color_scheme='dark')
	page = ctx.new_page()
	page.goto(URL, wait_until='networkidle')
	page.wait_for_timeout(500)
	page.keyboard.press('[')
	page.wait_for_timeout(300)
	page.hover('.rail-item.drafts')
	page.wait_for_timeout(300)
	page.hover('.rail-pop:popover-open a >> nth=2')
	page.wait_for_timeout(200)
	print('pop open while hovering pop:', page.evaluate("document.querySelectorAll('.rail-pop:popover-open').length"))
	page.screenshot(path=OUT)
	page.mouse.move(600, 400)
	page.wait_for_timeout(200)
	print('pop open after leave:', page.evaluate("document.querySelectorAll('.rail-pop:popover-open').length"))
	page.keyboard.press('2')
	page.wait_for_timeout(400)
	print('sidebar open after 2:', not page.evaluate("document.querySelector('.sidebar').classList.contains('closed')"))
	print('stale pops:', page.evaluate("document.querySelectorAll('.rail-pop:popover-open').length"))
	browser.close()
