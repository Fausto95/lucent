# Built as part of the app's `appmodules` library through React Native's C++
# module autolinking (see react-native.config.js).
cmake_minimum_required(VERSION 3.13)
set(CMAKE_VERBOSE_MAKEFILE on)

set(LUCENT_ROOT ${CMAKE_CURRENT_LIST_DIR}/..)
file(GLOB_RECURSE LUCENT_SOURCES CONFIGURE_DEPENDS ${LUCENT_ROOT}/cpp/*.cpp)

add_library(lucentnative OBJECT ${LUCENT_SOURCES})

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
  -std=c++20
  -ffp-contract=off
  -fexceptions
  -frtti
  -O2
  -Wno-unused-parameter
  -Wno-unused-variable
  -Wno-unused-label
  -Wno-gnu-statement-expression
  -Wno-parentheses-equality
  -Wno-comma
)

target_link_libraries(lucentnative jsi reactnative fbjni log)
