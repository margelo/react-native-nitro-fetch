//
//  NitroLogger.h
//  Flip NitroWSLoggingEnabled to log in release builds too.
//

#pragma once

#import <Foundation/Foundation.h>

extern BOOL NitroWSLoggingEnabled;

NS_INLINE void NitroWSLog(NSString *format, ...) {
  if (!NitroWSLoggingEnabled) return;
  va_list args;
  va_start(args, format);
  NSString *message = [[NSString alloc] initWithFormat:format arguments:args];
  va_end(args);
  NSLog(@"%@", message);
}
