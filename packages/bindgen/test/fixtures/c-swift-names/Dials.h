typedef struct DLDial *DLDialRef;

extern double DLDialGetSpeed(DLDialRef dial)
    CF_SWIFT_NAME(getter:DLDial.speed(self:));

extern DLDialRef DLDialCreate(double level) __attribute__((swift_name("DLDial.init(level:)")));

extern void DLDialReset(DLDialRef dial);
