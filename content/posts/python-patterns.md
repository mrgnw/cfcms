---
date: '2025-02-15'
description: Six patterns you'll actually use, with minimal examples.
pin: false
publish: true
tags:
- python
title: Python patterns, explained simply
---

Six patterns you'll actually use, with minimal examples.

## 1. Factory

A maker that builds the right thing when you ask.

```python
class LocalStore: pass
class CloudStore: pass

def make_store(kind):
	return LocalStore() if kind == "local" else CloudStore()

store = make_store("local")
```

## 2. Strategy

Pick a tool from a toolbox.

```python
strategies = {
	"normalize": lambda xs: [x / max(xs) for x in xs],
	"center": lambda xs: [x - (sum(xs) / len(xs)) for x in xs],
}

data = [2, 4, 6]
out = strategies["normalize"](data)
```

## 3. Decorator

Wrap a function to give it a bonus ability.

```python
def traced(fn):
	def inner(*args, **kwargs):
		print(f"calling {fn.__name__}")
		return fn(*args, **kwargs)
	return inner

@traced
def calc(x):
	return x * 3
```

## 4. Context Manager

Something that sets up and cleans up automatically.

```python
path = "file.txt"
with open(path, "w") as f:
	f.write("hi")
# file is closed automatically
```

Custom:

```python
from contextlib import contextmanager

@contextmanager
def timer():
	from time import time
	start = time()
	yield
	print(f"{time() - start:.2f}s")

with timer():
	do_work()
```

## 5. Iterator

A box that gives you the next item each time.

```python
class Batch:
	def __init__(self, items, size):
		self.items, self.size, self.i = items, size, 0

	def __iter__(self):
		return self

	def __next__(self):
		if self.i >= len(self.items):
			raise StopIteration
		chunk = self.items[self.i : self.i + self.size]
		self.i += self.size
		return chunk

for batch in Batch([1, 2, 3, 4], 2):
	print(batch)  # [1, 2] then [3, 4]
```

## 6. Observer

Listeners that react when something happens.

```python
listeners = []

def emit(event):
	for fn in listeners:
		fn(event)

listeners.append(lambda e: print(e.upper()))
emit("start")  # "START"
```

## 7. Protocol (bonus -- modern Python)

Define a shape without inheritance. If it quacks, it's a duck.

```python
from typing import Protocol

class Storable(Protocol):
	def save(self) -> None: ...
	def load(self) -> dict: ...

class FileStore:
	def save(self): ...
	def load(self) -> dict: ...

def backup(store: Storable):
	store.save()
```

`FileStore` satisfies `Storable` without inheriting from it. The type checker verifies the shape matches.
