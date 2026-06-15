---
id: benchmarks
title: Benchmarks
sidebar_position: 8
---

# Benchmarks

These results are **without prefetch**. A common misconception is that nitro-fetch is only faster when you prefetch — it isn't. Plain `fetch` is faster on its own; in our testing around **15–25% faster** than React Native's built-in `fetch` for end-to-end requests (release build, device idle on Wi-Fi). Prefetch makes the difference far larger still, but it's not where the win comes from.

How much faster depends heavily on how your backend is set up — connection reuse, HTTP/2, and especially **HTTP/3 over QUIC** widen the gap.

Example 10-run head-to-head (14 public endpoints, alternating order, stall-corrected). "%" is how much lower nitro's latency was; "×" is built-in ÷ nitro; "Drop" is samples discarded for JS-thread stalls:

| Run | Built-in (ms) | Nitro (ms) | % faster | × | Drop |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 196 | 152 | 22.5% | 1.29 | 3 |
| 2 | 198 | 148 | 25.3% | 1.34 | 1 |
| 3 | 197 | 148 | 24.9% | 1.33 | 1 |
| 4 | 189 | 150 | 20.5% | 1.26 | 2 |
| 5 | 189 | 146 | 22.6% | 1.29 | 0 |
| 6 | 189 | 148 | 21.9% | 1.28 | 3 |
| 7 | 187 | 147 | 21.4% | 1.27 | 4 |
| 8 | 197 | 142 | 28.0% | 1.39 | 4 |
| 9 | 190 | 144 | 24.5% | 1.32 | 1 |
| 10 | 187 | 149 | 20.4% | 1.26 | 3 |
| **Median** | **190** | **148** | **22.0%** | **1.28×** | 22 total |
| **Average** | **192** | **147** | **23.2%** | **1.30×** | — |

Numbers are device-, network-, and time-specific. **Try it yourself** in the example app → **Benchmark V2** (`example/src/screens/BenchmarkV2Screen.tsx`), on a release build.

If you have any concerns about the benchmark methodology, please [open an issue](https://github.com/margelo/react-native-nitro-fetch/issues).
