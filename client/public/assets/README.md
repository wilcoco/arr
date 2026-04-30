# Game Art Assets

현재는 모든 캐릭터/파츠가 인라인 SVG로 렌더링됩니다 (외부 파일 0개).
나중에 더 정교한 PNG/일러스트로 교체하려면 아래 경로에 파일 넣으면 자동 폴백됩니다.

## 캐릭터 (PNG, 256x256 권장, 투명 배경)

```
assets/characters/animal.png
assets/characters/robot.png
assets/characters/aircraft.png
```

`<GuardianImage type="animal" />` 컴포넌트가 PNG 우선, 없으면 SVG 사용.

## 파츠 (PNG, 64x64 권장)

```
assets/parts/{slot}_t{tier}.png

예:
assets/parts/head_t1.png
assets/parts/head_t5.png
assets/parts/body_t3.png
...
```

5 슬롯 × 5 티어 = 25개 (모두 옵션, 없으면 SVG)

## 추천 무료 에셋

- Kenney.nl (CC0)
- itch.io (무료 게임 아트)
- OpenGameArt.org

## SVG 직접 편집

`client/src/art/GuardianSvg.jsx`, `PartSvg.jsx` 에서 path/polygon 수정 가능.
지금 SVG는 미니멀 픽토그램 — 실제 캐릭터 일러스트는 그래픽 디자이너 작업 영역.
