/*
 * Lucent: renames the global symbols of the vendored QuickJS files, so an
 * app that links another copy (QuickJS itself, a library vendoring it) has
 * no duplicate or interposed lre_*, cr_*, dbuf_* or unicode_* symbols. Each
 * build has it first: cutils.h, libregexp.h and libunicode.h include it
 * (the one line Lucent adds to QuickJS's files), and every C file and
 * regexp.cpp includes one of them before anything it defines.
 *
 * Regenerate after an update (README.md): the names `nm -g --defined-only`
 * lists for the three objects, and the three callbacks regexp.cpp defines.
 */
#ifndef LUCENT_QUICKJS_PREFIX_H
#define LUCENT_QUICKJS_PREFIX_H

#define __dbuf_put_u16 lucent___dbuf_put_u16
#define __dbuf_put_u32 lucent___dbuf_put_u32
#define __dbuf_put_u64 lucent___dbuf_put_u64
#define __dbuf_putc lucent___dbuf_putc
#define cr_copy lucent_cr_copy
#define cr_free lucent_cr_free
#define cr_init lucent_cr_init
#define cr_invert lucent_cr_invert
#define cr_op lucent_cr_op
#define cr_op1 lucent_cr_op1
#define cr_realloc lucent_cr_realloc
#define cr_regexp_canonicalize lucent_cr_regexp_canonicalize
#define dbuf_claim lucent_dbuf_claim
#define dbuf_free lucent_dbuf_free
#define dbuf_init lucent_dbuf_init
#define dbuf_init2 lucent_dbuf_init2
#define dbuf_printf lucent_dbuf_printf
#define dbuf_put lucent_dbuf_put
#define dbuf_put_self lucent_dbuf_put_self
#define dbuf_putstr lucent_dbuf_putstr
#define has_suffix lucent_has_suffix
#define lre_canonicalize lucent_lre_canonicalize
#define lre_case_conv lucent_lre_case_conv
#define lre_check_stack_overflow lucent_lre_check_stack_overflow
#define lre_check_timeout lucent_lre_check_timeout
#define lre_compile lucent_lre_compile
#define lre_ctype_bits lucent_lre_ctype_bits
#define lre_exec lucent_lre_exec
#define lre_get_alloc_count lucent_lre_get_alloc_count
#define lre_get_capture_count lucent_lre_get_capture_count
#define lre_get_flags lucent_lre_get_flags
#define lre_get_groupnames lucent_lre_get_groupnames
#define lre_is_case_ignorable lucent_lre_is_case_ignorable
#define lre_is_cased lucent_lre_is_cased
#define lre_is_id_continue lucent_lre_is_id_continue
#define lre_is_id_start lucent_lre_is_id_start
#define lre_is_space_non_ascii lucent_lre_is_space_non_ascii
#define lre_parse_escape lucent_lre_parse_escape
#define lre_realloc lucent_lre_realloc
#define pstrcat lucent_pstrcat
#define pstrcpy lucent_pstrcpy
#define rqsort lucent_rqsort
#define strstart lucent_strstart
#define unicode_from_utf8 lucent_unicode_from_utf8
#define unicode_general_category lucent_unicode_general_category
#define unicode_normalize lucent_unicode_normalize
#define unicode_prop lucent_unicode_prop
#define unicode_script lucent_unicode_script
#define unicode_sequence_prop lucent_unicode_sequence_prop
#define unicode_to_utf8 lucent_unicode_to_utf8

#endif
