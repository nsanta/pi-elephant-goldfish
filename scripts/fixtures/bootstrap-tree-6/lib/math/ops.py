def add(a: float, b: float) -> float:
    return a + b

def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))

TOLERANCE = 1e-9
