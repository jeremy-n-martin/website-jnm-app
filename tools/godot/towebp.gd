extends SceneTree
## Convertit les PNG/JPG d'un dossier en WebP pour le site.
## Usage : godot --headless -s towebp.gd -- <entrée> <sortie> <largeur max> [nearest]

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() < 3:
		printerr("usage: -- <in> <out> <maxw> [nearest]")
		quit(2)
		return
	var src: String = args[0]
	var dst: String = args[1]
	var max_w := int(args[2])
	var interp := Image.INTERPOLATE_NEAREST if args.size() > 3 and args[3] == "nearest" else Image.INTERPOLATE_LANCZOS
	DirAccess.make_dir_recursive_absolute(dst)
	var files := Array(DirAccess.get_files_at(src))
	files.sort()
	var n := 0
	for f in files:
		var ext: String = f.get_extension().to_lower()
		if ext not in ["png", "jpg", "jpeg", "webp"]:
			continue
		var img := Image.load_from_file(src.path_join(f))
		if img == null or img.is_empty():
			printerr("illisible: ", f)
			continue
		if img.get_width() > max_w:
			img.resize(max_w, int(round(img.get_height() * float(max_w) / img.get_width())), interp)
		img.save_webp(dst.path_join(f.get_basename() + ".webp"), false, 0.85)
		n += 1
	print("converted ", n)
	quit(0 if n > 0 else 1)
