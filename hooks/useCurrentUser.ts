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
  const [firebaseReady, setFirebaseReady] = useState(false);

  useEffect(() => {
    const unsubscribe = listenCurrentUser(async (user: User | null) => {
      setFirebaseReady(true); // Firebase auth state 확인 즉시 set
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

      let staff = null;
      try {
        staff = await getStaffByUid(user.uid);
      } catch {
        setCurrentUser(null);
        setAuthReady(true);
        router.replace("/login");
        return;
      }

      if (!staff || !staff.active) {
        setCurrentUser(null);
        setAuthReady(true);
        router.replace("/login");
        return;
      }

      try {
        sessionStorage.setItem(STAFF_CACHE_KEY, JSON.stringify(staff));
      } catch {}

      setCurrentUser(staff);
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, [router]);

  return { currentUser, authReady, firebaseReady };
}
