//
//  WsTrace.hpp
//  Pods
//
//  Created by Ritesh Shukla on 03.04.26.
//

#if defined(NITRO_WS_TRACING)

#if defined(__ANDROID__)

#include <android/trace.h>
#include <string>

#define WS_TRACE_BEGIN(label) ATrace_beginSection(label)
#define WS_TRACE_END()        ATrace_endSection()

#define WS_TRACE_ASYNC_BEGIN(label, cookie) ATrace_beginAsyncSection(label, cookie)
#define WS_TRACE_ASYNC_END(label, cookie)   ATrace_endAsyncSection(label, cookie)

#define WS_TRACE_INT(label, value) ATrace_setCounter(label, value)

#elif defined(__APPLE__)

#include <os/log.h>
#include <os/signpost.h>

// Shared log handle — defined in NWWebSocketConnection.mm
namespace margelo::nitro::nitrofetchwebsockets {
  os_log_t wsTraceLog();
}

#define WS_TRACE_BEGIN(label) \
  os_signpost_interval_begin(margelo::nitro::nitrofetchwebsockets::wsTraceLog(), \
    os_signpost_id_generate(margelo::nitro::nitrofetchwebsockets::wsTraceLog()), \
    "NitroWS", "%s", label)

#define WS_TRACE_END() ((void)0)

// iOS async tracing uses signpost IDs
#define WS_TRACE_ASYNC_BEGIN(label, cookie) ((void)0)
#define WS_TRACE_ASYNC_END(label, cookie)   ((void)0)
#define WS_TRACE_INT(label, value)          ((void)0)

#endif // __ANDROID__ / __APPLE__

#else // !NITRO_WS_TRACING

#define WS_TRACE_BEGIN(label)               ((void)0)
#define WS_TRACE_END()                      ((void)0)
#define WS_TRACE_ASYNC_BEGIN(label, cookie) ((void)0)
#define WS_TRACE_ASYNC_END(label, cookie)   ((void)0)
#define WS_TRACE_INT(label, value)          ((void)0)

#endif
