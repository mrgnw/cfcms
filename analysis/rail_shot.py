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
	closed = page.evaluate("document.querySelector('.sidebar').classList.contains('closed')")
	assert closed, 'sidebar should collapse on ['

	page.hover('.rail-item.drafts')
	page.wait_for_timeout(300)
	page.hover('.rail-pop:popover-open a >> nth=2')
	page.wait_for_timeout(200)
	assert page.evaluate("document.querySelectorAll('.rail-pop:popover-open').length") == 1, 'popover stays while hovered'
	page.screenshot(path=OUT)
	page.mouse.move(600, 400)
	page.wait_for_timeout(200)
	assert page.evaluate("document.querySelectorAll('.rail-pop:popover-open').length") == 0, 'popover closes on leave'

	page.click('.rail-item.ready')
	page.wait_for_url('**/ready')
	page.wait_for_timeout(300)
	assert not page.evaluate("document.querySelector('.sidebar').classList.contains('closed')"), 'rail click opens sidebar'
	assert page.evaluate("document.querySelector('.stage.ready').classList.contains('active')"), 'stepper marks ready'
	rows = page.evaluate("document.querySelectorAll('.post-list .row').length")
	assert rows == 5, f'ready list should have 5 rows, got {rows}'

	page.click('.post-list .row >> nth=0')
	page.wait_for_url('**/ready/posts/*')
	page.wait_for_timeout(300)
	assert page.evaluate("document.querySelectorAll('.post-list .row').length") == 5, 'filter survives opening a post'
	current = page.evaluate("document.querySelector('.rail-item.current')?.className")
	assert current and ('ready' in current or 'editing' in current), f'current marker: {current}'

	page.keyboard.press('2')
	page.wait_for_url('**/posts/*#editing')
	page.wait_for_timeout(400)
	assert '/ready/' not in page.url, 'hash jump clears the stage'
	top = page.evaluate("document.getElementById('editing').getBoundingClientRect().top - document.querySelector('.post-list').getBoundingClientRect().top")
	assert -2 <= top <= 12, f'editing heading should be at list top, got {top}'

	page.evaluate("document.getElementById('recent').scrollIntoView({ block: 'start' })")
	page.wait_for_timeout(400)
	assert page.url.endswith('#recent'), f'scroll should write #recent, got {page.url}'
	page.evaluate("document.getElementById('everything').scrollIntoView({ block: 'start' })")
	page.wait_for_timeout(400)
	assert page.url.endswith('#everything'), f'got {page.url}'
	assert page.evaluate("history.length") < 10, 'replaceState must not grow history'

	page.keyboard.press('[')
	page.wait_for_timeout(200)
	page.click('.rail-item.live')
	page.wait_for_url('**/live/posts/*')
	print('ok', page.url)
	browser.close()
