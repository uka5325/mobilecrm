"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "firebase/auth";
import { getStaffByUid, listenCurrentUser } from "@/lib/auth";
import type { StaffUser } from "@/lib/auth";

const STAFF_CACHE_KEY = "arc_crm_staff_user";

export function useCurrentUser() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<StaffUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribe = listenCurrentUser(async (user: User | null) => {
      if (!user) {
        setCurrentUser(null);
        setAuthReady(true);
        router.replace("/login");
        return;
      }

      try {
        const raw = sessionStorage.getItem(STAFF_CACHE_KEY);
        if (raw) {
          const cached: StaffUser = JSON.parse(raw);
          if (cached.uid === user.uid && cached.active) {
            setCurrentUser(cached);
            setAuthReady(true);
            return;
          }
        }
      } catch {}

      const staff = await getStaffByUid(user.uid);

      if (!staff || !staff.active) {
        setCurrentUser(null);
        setAuthReady(true);
        router.replace("/login");
        return;
      }

      setCurrentUser(staff);
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, [router]);

  return { currentUser, authReady };
}
