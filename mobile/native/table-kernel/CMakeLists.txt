cmake_minimum_required(VERSION 3.22)
project(coc_table_kernel LANGUAGES C CXX)
add_library(coc_table_kernel STATIC table-kernel.cpp
  vendor/expat/xcs.c
  vendor/expat/xmlparse.c vendor/expat/xmlrole.c vendor/expat/xmltok.c
  vendor/expat/random_dev_urandom.c)
set_target_properties(coc_table_kernel PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_compile_features(coc_table_kernel PRIVATE cxx_std_17)
target_compile_definitions(coc_table_kernel PRIVATE XML_STATIC=1 HAVE_EXPAT_CONFIG_H=1)
target_compile_options(coc_table_kernel PRIVATE -O3 -fvisibility=hidden)
target_include_directories(coc_table_kernel PRIVATE vendor/expat)
target_link_libraries(coc_table_kernel PUBLIC z)
