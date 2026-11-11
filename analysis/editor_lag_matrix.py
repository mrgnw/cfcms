# /// script
# requires-python = ">=3.14"
# ///
# Runs analysis/editor-lag.mjs over editor x cpu x latency x post, in isolated lanes.
# Each lane has its own server and db copy, so one run's saves never reach another run's polls.
import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SANDBOX = Path('/tmp/cfcms-lag')
LANES = 4
BASE_PORT = 5300
SECONDS = 30
EDITORS = ['milkdown', 'aragonite']
CPU_RATES = [1, 4]
LATENCIES = [0, 400]
SLUGS = ['marker-ids', 'turboquant-gemma4-24gb', 'lag-bench-big']
PLAN = sys.argv[2] if len(sys.argv) > 2 else 'matrix'
RESULTS = SANDBOX / f'results-{PLAN}.jsonl'


def start_lane(lane: int) -> subprocess.Popen:
	lane_dir = SANDBOX / f'lane{lane}'
	shutil.rmtree(lane_dir, ignore_errors=True)
	lane_dir.mkdir()
	subprocess.run(['sqlite3', str(SANDBOX / 'data/cms.db'), f'.backup {lane_dir / "cms.db"}'], check=True)
	port = BASE_PORT + lane
	env = {
		**os.environ,
		'HOST': '127.0.0.1',
		'PORT': str(port),
		'ORIGIN': f'http://127.0.0.1:{port}',
		'BLOG_CONTENT_BASE_DIR': str(SANDBOX / 'blog'),
		'BLOG_CMS_DB': str(lane_dir / 'cms.db'),
	}
	log = open(lane_dir / 'server.log', 'w')
	server = subprocess.Popen(['node', 'build/index.js'], cwd=ROOT, env=env, stdout=log, stderr=log)
	for _ in range(50):
		try:
			urllib.request.urlopen(f'http://127.0.0.1:{port}/api/posts', timeout=5)
			return server
		except OSError:
			time.sleep(0.2)
	raise RuntimeError(f'lane {lane} server did not start')


def run_lane(lane: int, jobs: queue.Queue, lock: threading.Lock):
	server = start_lane(lane)
	try:
		while True:
			try:
				editor, cpu, latency, slug, seconds, extra_env = jobs.get_nowait()
			except queue.Empty:
				return
			args = [
				'node',
				'analysis/editor-lag.mjs',
				f'http://localhost:{BASE_PORT + lane}',
				slug,
				editor,
				str(cpu),
				str(seconds),
				str(latency),
			]
			env = {**os.environ, **extra_env}
			done = subprocess.run(args, cwd=ROOT, env=env, capture_output=True, text=True, timeout=seconds * 4 + 60)
			line = (
				done.stdout.strip().splitlines()[-1]
				if done.returncode == 0
				else json.dumps(
					{
						'editor': editor,
						'cpuRate': cpu,
						'latencyMs': latency,
						'slug': slug,
						'failed': done.stderr[-400:],
					}
				)
			)
			with lock:
				with RESULTS.open('a') as out:
					out.write(line + '\n')
				print(line[:160], flush=True)
	finally:
		server.terminate()


def main():
	RESULTS.unlink(missing_ok=True)
	jobs: queue.Queue = queue.Queue()
	if PLAN in ('scenarios', 'all'):
		for editor in EDITORS:
			jobs.put((editor, 4, 400, 'marker-ids', 600, {}))
			jobs.put((editor, 4, 400, 'turboquant-gemma4-24gb', 45, {'SECOND_TAB': '1'}))
			jobs.put((editor, 1, 400, 'marker-ids', 45, {'BROWSER': 'webkit'}))
			jobs.put((editor, 1, 400, 'lag-bench-big', 45, {'BROWSER': 'webkit'}))
	if PLAN == 'pileup':
		for editor in EDITORS:
			jobs.put((editor, 4, 400, 'turboquant-gemma4-24gb', 45, {'STALL_MS': '15000'}))
			jobs.put((editor, 4, 400, 'turboquant-gemma4-24gb', 60, {'STALL_MS': '30000'}))
			jobs.put((editor, 4, 400, 'marker-ids', 45, {'NAV_FIRST': '30'}))
			jobs.put((editor, 4, 400, 'marker-ids', 45, {}))
	if PLAN in ('matrix', 'all'):
		for slug in SLUGS:
			for editor in EDITORS:
				for cpu in CPU_RATES:
					for latency in LATENCIES:
						jobs.put((editor, cpu, latency, slug, SECONDS, {}))
	lanes = int(sys.argv[1]) if len(sys.argv) > 1 else LANES
	lock = threading.Lock()
	threads = [threading.Thread(target=run_lane, args=(lane, jobs, lock)) for lane in range(lanes)]
	for thread in threads:
		thread.start()
	for thread in threads:
		thread.join()


if __name__ == '__main__':
	main()
