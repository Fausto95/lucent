// Lucent runtime — the keys of WeakMap and WeakSet (weak.h).
#include "weak.h"

#include <algorithm>

namespace lucent {

void Object::keyIn(const std::shared_ptr<detail::WeakTable>& table) {
  if (!weakTables_) weakTables_ = new std::vector<std::weak_ptr<detail::WeakTable>>();

  auto& tables = *weakTables_;
  // Collections gone since are forgotten; one already listed is not listed twice.
  std::erase_if(tables, [](const std::weak_ptr<detail::WeakTable>& t) { return t.expired(); });
  bool listed = std::any_of(tables.begin(), tables.end(), [&](const std::weak_ptr<detail::WeakTable>& t) {
    return !t.owner_before(table) && !table.owner_before(t);
  });
  if (!listed) tables.push_back(table);
}

void Object::dropWeakEntries() noexcept {
  // Taken first: dropping an entry frees its value, which may free other keys.
  std::vector<std::weak_ptr<detail::WeakTable>>* tables = std::exchange(weakTables_, nullptr);
  for (const auto& weak : *tables) {
    if (auto table = weak.lock()) table->drop(this);
  }
  delete tables;
}

}  // namespace lucent
