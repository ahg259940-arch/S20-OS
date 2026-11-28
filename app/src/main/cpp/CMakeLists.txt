cmake_minimum_required(VERSION 3.22.1)
project(nexus_node_bridge LANGUAGES CXX)

if(NOT DEFINED NEXUS_NODE_MOBILE_ROOT)
    message(FATAL_ERROR "NEXUS_NODE_MOBILE_ROOT must point to the verified Node Mobile runtime")
endif()

add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES
    IMPORTED_LOCATION "${NEXUS_NODE_MOBILE_ROOT}/bin/${ANDROID_ABI}/libnode.so")

add_library(nexus_node SHARED nexus_node.cpp)
target_include_directories(nexus_node PRIVATE "${NEXUS_NODE_MOBILE_ROOT}/include/node")
target_compile_features(nexus_node PRIVATE cxx_std_17)
find_library(android-log log)
target_link_libraries(nexus_node PRIVATE node ${android-log})
