# Tower 2D Sprites

Tower Defense Mega Pack 같은 3D 에셋을 2D 맵에 사용하기 위한 PNG 폴더.

## 파일 명명 규칙

```
{class}_t{tier}.png    # tier 1-5
```

예:
- `arrow_t1.png` ~ `arrow_t5.png`
- `cannon_t1.png` ~ `cannon_t5.png`
- `magic_t1.png`, `support_t1.png`, `production_t1.png`, `revenue_t1.png`

## 권장 사양

- 사이즈: **256x256** PNG
- 배경: **투명**
- 카메라 각도: **30° 탑다운 이소메트릭** (입체감 + 맵 친화)
- 그림자: 포함 (지면 동그란 그림자)

## 자동 생성 (Unity)

Unity 에디터에서:
1. `Guardian AR > Tower Sprite Renderer` 메뉴
2. 6 클래스 프리팹 드래그
3. **Render All** 클릭
4. `Assets/Generated/Towers/*.png` 생성됨
5. 그 파일들을 이 폴더에 복사

## 폴백 동작

PNG가 없으면 자동으로 인라인 SVG로 그려집니다 (`TowerSprite.jsx`).
PNG를 추가하면 자동으로 우선 사용.

## AR 모드 (3D 그대로)

PNG는 2D 맵용이고, AR 모드에서는 원본 FBX 모델을 그대로 사용:
- Unity AR 씬의 `ARFixedGuardianPlacer` 가 3D 프리팹 인스턴스화
- `tower_class` 필드로 어떤 프리팹을 쓸지 결정 (`fixedGuardianPrefab` 슬롯에 매핑)
