# Built as part of the app's `appmodules` library through React Native's C++
# module autolinking (see react-native.config.js).
cmake_minimum_required(VERSION 3.13)
set(CMAKE_VERBOSE_MAKEFILE on)

set(LUCENT_ROOT ${CMAKE_CURRENT_LIST_DIR}/..)
file(GLOB_RECURSE LUCENT_SOURCES CONFIGURE_DEPENDS ${LUCENT_ROOT}/cpp/*.cpp)
# Projects with platform modules generate one set of files per target
# (cpp/generated/ios, cpp/generated/android); Android builds its own.
list(FILTER LUCENT_SOURCES EXCLUDE REGEX "/cpp/generated/(ios|host)/")

# The vendored regular expression engine is C. It is a library of its own so
# that React Native's C++ compile options never reach it.
file(GLOB LUCENT_C_SOURCES CONFIGURE_DEPENDS ${LUCENT_ROOT}/cpp/third_party/quickjs/*.c)
add_library(lucentregexp STATIC ${LUCENT_C_SOURCES})
set_target_properties(lucentregexp PROPERTIES POSITION_INDEPENDENT_CODE ON C_STANDARD 11)
target_compile_options(lucentregexp PRIVATE -w -O2)

add_library(lucentnative OBJECT ${LUCENT_SOURCES})

target_include_directories(lucentnative PUBLIC
  ${LUCENT_ROOT}/cpp
  ${LUCENT_ROOT}/cpp/generated/android
  ${LUCENT_ROOT}/cpp/generated
  ${LUCENT_ROOT}/cpp/rn
  ${CMAKE_CURRENT_LIST_DIR}/include
)

if(COMMAND target_compile_reactnative_options)
  target_compile_reactnative_options(lucentnative PRIVATE)
endif()
# Hidden: calls between the runtime's files are direct instead of through the
# PLT of the app's shared library (a string argument made three such calls).
# Natives are bound with RegisterNatives, so nothing is looked up by name.
target_compile_options(lucentnative PRIVATE
  -fvisibility=hidden
  $<$<COMPILE_LANGUAGE:CXX>:-fvisibility-inlines-hidden>
  $<$<COMPILE_LANGUAGE:CXX>:-std=c++20>
  $<$<COMPILE_LANGUAGE:CXX>:-ffp-contract=off>
  $<$<COMPILE_LANGUAGE:CXX>:-fexceptions>
  $<$<COMPILE_LANGUAGE:CXX>:-frtti>
  $<$<COMPILE_LANGUAGE:CXX>:-O2>
  $<$<COMPILE_LANGUAGE:CXX>:-Wno-unused-parameter>
  $<$<COMPILE_LANGUAGE:CXX>:-Wno-unused-variable>
  $<$<COMPILE_LANGUAGE:CXX>:-Wno-unused-label>
  $<$<COMPILE_LANGUAGE:CXX>:-Wno-gnu-statement-expression>
  $<$<COMPILE_LANGUAGE:CXX>:-Wno-parentheses-equality>
  $<$<COMPILE_LANGUAGE:CXX>:-Wno-comma>
)

target_link_libraries(lucentnative jsi reactnative fbjni log lucentregexp)
