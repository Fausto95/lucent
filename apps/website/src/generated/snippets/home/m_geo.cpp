double m_geo::squaredDistance(lucent::Ref<lucent_app::S_Point> p0_a, lucent::Ref<lucent_app::S_Point> p1_b) {
  lucent::Ref<lucent_app::S_Point> a = std::move(p0_a);
  lucent::Ref<lucent_app::S_Point> b = std::move(p1_b);
  double dx = a->x - b->x;
  double dy = a->y - b->y;
  return dx * dx + dy * dy;
}
