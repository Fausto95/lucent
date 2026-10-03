double m_geo::squaredDistance(lucent::Ref<lucent_app::S_Point> p0_, lucent::Ref<lucent_app::S_Point> p1_) {
  double v2_ = p0_->x;
  double v3_ = p1_->x;
  double dx = v2_ - v3_;
  double v5_ = p0_->y;
  double v6_ = p1_->y;
  double dy = v5_ - v6_;
  double v10_ = dx * dx;
  return v10_ + dy * dy;
}
