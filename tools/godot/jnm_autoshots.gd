extends Node
## Explorateur de captures, injecté en autoload par release.ps1 (override.cfg temporaire).
## Il joue « à l'aveugle » : clique les boutons visibles, envoie touches et clics, et garde les
## écrans suffisamment différents les uns des autres. Variables d'environnement :
##   JNM_SHOTS_DIR    dossier de sortie (obligatoire, sinon le nœud ne fait rien)
##   JNM_SHOTS_COUNT  nombre d'images voulues (10 par défaut)
##   JNM_SHOTS_TIME   durée maximale en secondes (100 par défaut)

const AVOID := ["quit", "quitter", "exit", "sortir", "réinitialis", "reinitialis", "reset", "supprim",
	"effacer", "delete", "erase", "crédit", "credit", "langue", "language", "plein écran", "fullscreen"]
const PREFER := ["jouer", "play", "commencer", "start", "continuer", "continue", "nouvelle", "new",
	"entrer", "suivant", "next", "ok", "valider", "go"]
const BACK := ["retour", "back", "◀", "←", "menu", "fermer", "close", "annuler", "cancel", "précédent"]
const THUMB := Vector2i(96, 54)

var out := ""
var target := 10
var budget := 100.0
var kept: Array[PackedByteArray] = []
var clicks := {}
var same_streak := 0
var pokes_here := 0
var rng := RandomNumberGenerator.new()


func _ready() -> void:
	out = OS.get_environment("JNM_SHOTS_DIR")
	if out.is_empty():
		queue_free()
		return
	process_mode = Node.PROCESS_MODE_ALWAYS
	target = maxi(1, int(OS.get_environment("JNM_SHOTS_COUNT"))) if OS.get_environment("JNM_SHOTS_COUNT") else 10
	budget = float(OS.get_environment("JNM_SHOTS_TIME")) if OS.get_environment("JNM_SHOTS_TIME") else 100.0
	rng.seed = 7
	DirAccess.make_dir_recursive_absolute(out)
	_run()


func _run() -> void:
	var t0 := Time.get_ticks_msec()
	await _wait(3.0)
	await _shot()
	while kept.size() < target and (Time.get_ticks_msec() - t0) / 1000.0 < budget:
		if same_streak >= 4:
			_key(KEY_ESCAPE)
			same_streak = 0
		elif not _click_button():
			_poke()
			pokes_here += 1
		await _wait(1.4)
		await _shot()
	print("jnm_autoshots: ", kept.size(), " capture(s)")
	get_tree().quit()


func _wait(s: float) -> void:
	await get_tree().create_timer(s, true, false, true).timeout


# ---------- captures ----------

func _shot() -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	if img == null or img.is_empty():
		return
	var thumb := img.duplicate() as Image
	thumb.convert(Image.FORMAT_L8)
	thumb.resize(THUMB.x, THUMB.y, Image.INTERPOLATE_BILINEAR)
	var px := thumb.get_data()
	if _flat(px):
		return
	for k in kept:
		if _diff(k, px) < 0.018:
			same_streak += 1
			return
	same_streak = 0
	pokes_here = 0
	kept.append(px)
	var w := img.get_width()
	if w < 1280:
		var f := ceili(1280.0 / w)
		img.resize(w * f, img.get_height() * f, Image.INTERPOLATE_NEAREST)
	img.save_png(out.path_join("auto-%02d.png" % kept.size()))


func _diff(a: PackedByteArray, b: PackedByteArray) -> float:
	var s := 0
	for i in a.size():
		s += absi(a[i] - b[i])
	return s / (255.0 * a.size())


func _flat(px: PackedByteArray) -> bool:
	var lo := 255
	var hi := 0
	for v in px:
		lo = mini(lo, v)
		hi = maxi(hi, v)
	return hi - lo < 18  # écran uni : chargement, fondu


# ---------- interactions ----------

func _click_button() -> bool:
	var vp := get_viewport().get_visible_rect()
	var best: BaseButton = null
	var best_score := -INF
	for n in get_tree().root.find_children("*", "BaseButton", true, false):
		var b := n as BaseButton
		if not b.is_visible_in_tree() or b.disabled or not vp.intersects(b.get_global_rect()):
			continue
		var label := _label(b)
		if AVOID.any(func(w): return label.contains(w)):
			continue
		var key := str(b.get_path()) + "|" + label
		var score: float = -3.0 * float(clicks.get(key, 0)) + rng.randf()
		if PREFER.any(func(w): return label.begins_with(w)):
			score += 2.0
		if BACK.any(func(w): return label.contains(w)):
			score -= 2.5
		if score > best_score:
			best_score = score
			best = b
	if best == null:
		return false
	# Seul un bouton « retour » reste : on explore d'abord l'écran par des clics et des touches.
	if BACK.any(func(w): return _label(best).contains(w)) and pokes_here < 3:
		return false
	var k := str(best.get_path()) + "|" + _label(best)
	clicks[k] = clicks.get(k, 0) + 1
	if clicks[k] > 3:
		return false
	print("jnm_autoshots: clic « ", _label(best).replace("\n", " ").left(40), " »")
	# Le signal plutôt qu'un clic simulé : indépendant de l'échelle d'affichage du jeu.
	best.pressed.emit()
	return true


func _label(b: BaseButton) -> String:
	var t := ""
	if "text" in b:
		t = str(b.text)
	if t.is_empty():
		t = str(b.tooltip_text) + " " + b.name
	return t.strip_edges().to_lower()


func _poke() -> void:
	var size := get_viewport().get_visible_rect().size
	match rng.randi_range(0, 5):
		0, 1:
			_tap(Vector2(rng.randf_range(0.15, 0.85) * size.x, rng.randf_range(0.2, 0.85) * size.y))
		2:
			_key(KEY_ENTER)
		3:
			_key([KEY_RIGHT, KEY_LEFT, KEY_UP, KEY_DOWN].pick_random())
		4:
			_key(KEY_SPACE)
		5:
			for a in ["ui_accept", "ui_right", "ui_down"]:
				if InputMap.has_action(a):
					Input.action_press(a)
					Input.action_release.call_deferred(a)
					break


func _tap(canvas_pos: Vector2) -> void:
	# Coordonnées du canevas → coordonnées de la fenêtre, comme un vrai clic.
	var pos := get_viewport().get_screen_transform() * canvas_pos
	for pressed in [true, false]:
		var e := InputEventMouseButton.new()
		e.button_index = MOUSE_BUTTON_LEFT
		e.pressed = pressed
		e.position = pos
		e.global_position = pos
		Input.parse_input_event(e)


func _key(code: Key) -> void:
	for pressed in [true, false]:
		var e := InputEventKey.new()
		e.keycode = code
		e.physical_keycode = code
		e.pressed = pressed
		Input.parse_input_event(e)
