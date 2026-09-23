# Built as part of the app's `appmodules` library through React Native's C++
# module autolinking (see react-native.config.js).
cmake_minimum_required(VERSION 3.13)
set(CMAKE_VERBOSE_MAKEFILE on)

set(LUCENT_ROOT ${CMAKE_CURRENT_LIST_DIR}/..)
file(GLOB_RECURSE LUCENT_SOURCES CONFIGURE_DEPENDS ${LUCENT_ROOT}/cpp/*.cpp)
# The vendored regular expression engine is C, compiled without warnings.
file(GLOB LUCENT_C_SOURCES CONFIGURE_DEPENDS ${LUCENT_ROOT}/cpp/third_party/quickjs/*.c)
set_source_files_properties(${LUCENT_C_SOURCES} PROPERTIES COMPILE_OPTIONS "-w")

add_library(lucentnative OBJECT ${LUCENT_SOURCES} ${LUCENT_C_SOURCES})

target_include_directories(lucentnative PUBLIC
  ${LUCENT_ROOT}/cpp
  ${LUCENT_ROOT}/cpp/generated
  ${LUCENT_ROOT}/cpp/rn
  ${CMAKE_CURRENT_LIST_DIR}/include
)

if(COMMAND target_compile_reactnative_options)
  target_compile_reactnative_options(lucentnative PRIVATE)
endif()
target_compile_options(lucentnative PRIVATE
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

target_link_libraries(lucentnative jsi reactnative fbjni log)
