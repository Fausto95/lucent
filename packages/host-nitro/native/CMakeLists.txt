project({{moduleName}})
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME {{moduleName}})
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

add_library(${PACKAGE_NAME} SHARED src/main/cpp/cpp-adapter.cpp)

include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/{{moduleName}}+autolinking.cmake)

include_directories("../cpp")
