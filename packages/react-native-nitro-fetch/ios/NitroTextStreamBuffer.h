#pragma once

#include <stdint.h>
#include <string.h>

#define TSB_HEADER_SIZE 64
#define TSB_STATUS_OPEN 0
#define TSB_STATUS_DONE 1
#define TSB_STATUS_ERROR 2
#define TSB_STATUS_CANCELLED 3
#define TSB_STATUS_OVERFLOW 4

typedef struct {
  uint32_t magic;
  uint16_t version;
  uint16_t headerSize;
  uint64_t committed;
  uint64_t capacity;
  uint32_t status;
} TSBHeader;

static inline void tsb_init(void *base, uint64_t capacity) {
  memset(base, 0, TSB_HEADER_SIZE);
  TSBHeader *h = (TSBHeader *)base;
  h->magic = 0x31425354;
  h->version = 1;
  h->headerSize = TSB_HEADER_SIZE;
  h->capacity = capacity;
}

static inline void tsb_append(void *base, const void *src, uint64_t len) {
  TSBHeader *h = (TSBHeader *)base;
  if (h->status != TSB_STATUS_OPEN) return;
  if (len > h->capacity - h->committed) {
    __atomic_store_n(&h->status, TSB_STATUS_OVERFLOW, __ATOMIC_RELEASE);
    return;
  }
  memcpy((uint8_t *)base + TSB_HEADER_SIZE + h->committed, src, len);
  __atomic_store_n(&h->committed, h->committed + len, __ATOMIC_RELEASE);
}

static inline void tsb_set_status(void *base, int status) {
  TSBHeader *h = (TSBHeader *)base;
  if (h->status == TSB_STATUS_OPEN) __atomic_store_n(&h->status, status, __ATOMIC_RELEASE);
}
