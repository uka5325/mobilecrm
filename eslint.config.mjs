import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Next 16에서 기본 활성화된 신규 규칙. 본 코드베이스의 캐시 하이드레이션 /
      // 의존성 변경 시 상태 초기화 패턴은 의도된 것이며 빌드를 막지 않는다.
      // 산재한 effect들의 일괄 리팩터는 별도 품질 과제로 분리하고,
      // 가시성은 유지하되 error→warn으로 낮춘다.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
