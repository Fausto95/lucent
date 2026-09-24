# Built into the app's `appmodules` library through React Native's C++
# module autolinking (see react-native.config.js).
cmake_minimum_required(VERSION 3.13)

add_library(benchturbocxx OBJECT ${CMAKE_CURRENT_LIST_DIR}/../cpp/BenchTurboCxx.cpp)
target_include_directories(benchturbocxx PUBLIC ${CMAKE_CURRENT_LIST_DIR}/../cpp ${CMAKE_CURRENT_LIST_DIR}/include)
if(COMMAND target_compile_reactnative_options)
  target_compile_reactnative_options(benchturbocxx PRIVATE)
endif()
target_link_libraries(benchturbocxx jsi reactnative)
